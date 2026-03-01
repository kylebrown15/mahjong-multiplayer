// server/game.js — Single game room state
const {
  createFullTileSet, shuffle, tileKey, tilesMatch, sortTiles,
  canClaimPong, canClaimKong, canClaimChow, getChowOptions,
  getConcealedKongs, canWinWith, isWinningHand, scoreHand
} = require('./tiles');

const SEATS = ['east', 'south', 'west', 'north'];

class MahjongGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.code = '';
    this.players = [null, null, null, null];
    this.state = 'waiting';
    this.wall = [];
    this.deadWall = [];
    this.hands = [[], [], [], []];
    this.melds = [[], [], [], []];
    this.discards = [[], [], [], []];
    this.allDiscards = [];
    this.currentTurn = 0;
    this.turnPhase = 'draw';
    this.lastDiscard = null;
    this.lastDiscardSeat = -1;
    this.pendingClaims = {};
    this.claimTimer = null;
    this.roundWind = 'east';
    this.turnCount = 0;
    this.drawnTile = null;
    this.winner = -1;
    this.winScore = null;
  }

  addPlayer(pid, name) {
    const s = this.players.findIndex(p => p === null);
    if (s === -1) return -1;
    this.players[s] = { id: pid, name, connected: true };
    return s;
  }
  removePlayer(pid) {
    const s = this.players.findIndex(p => p && p.id === pid);
    if (s >= 0) this.players[s] = null;
    return s;
  }
  getSeat(pid) { return this.players.findIndex(p => p && p.id === pid); }
  isFull() { return this.players.every(p => p !== null); }
  playerCount() { return this.players.filter(p => p !== null).length; }

  startGame() {
    if (!this.isFull()) return false;
    this.state = 'playing';
    this.wall = shuffle(createFullTileSet());
    this.deadWall = this.wall.splice(0, 14);
    this.hands = [[], [], [], []];
    this.melds = [[], [], [], []];
    this.discards = [[], [], [], []];
    this.allDiscards = [];
    this.currentTurn = 0;
    this.turnCount = 0;
    this.winner = -1;
    this.winScore = null;
    this.lastDiscard = null;

    // Standard deal: 3 rounds of 4, then 1 each, east gets extra
    for (let r = 0; r < 3; r++)
      for (let s = 0; s < 4; s++)
        for (let i = 0; i < 4; i++) this.hands[s].push(this.wall.pop());
    for (let s = 0; s < 4; s++) this.hands[s].push(this.wall.pop());
    this.hands[0].push(this.wall.pop()); // East 14th

    for (let i = 0; i < 4; i++) this.hands[i] = sortTiles(this.hands[i]);

    this.turnPhase = 'discard'; // East starts with discard (has 14)
    this.drawnTile = this.hands[0][this.hands[0].length - 1];
    return true;
  }

  drawTile(seat) {
    if (this.state !== 'playing' || seat !== this.currentTurn || this.turnPhase !== 'draw')
      return { error: 'Cannot draw now' };
    if (this.wall.length === 0) {
      this.state = 'finished'; this.winner = -1;
      return { action: 'draw_game' };
    }
    const tile = this.wall.pop();
    this.hands[seat].push(tile);
    this.drawnTile = tile;
    this.turnPhase = 'discard';
    this.turnCount++;
    return {
      action: 'drew',
      tile,
      canWin: isWinningHand(this.hands[seat], this.melds[seat]),
      concealedKongs: getConcealedKongs(this.hands[seat]),
      upgradeKongs: this.melds[seat]
        .filter(m => m.type === 'pong' && this.hands[seat].some(t => tilesMatch(t, m.tiles[0])))
        .map(m => this.hands[seat].find(t => tilesMatch(t, m.tiles[0])))
    };
  }

  discard(seat, tileId) {
    if (this.state !== 'playing' || seat !== this.currentTurn || this.turnPhase !== 'discard')
      return { error: 'Cannot discard now' };
    const idx = this.hands[seat].findIndex(t => t.id === tileId);
    if (idx === -1) return { error: 'Tile not in hand' };

    const tile = this.hands[seat].splice(idx, 1)[0];
    this.discards[seat].push(tile);
    this.allDiscards.push({ tile, from: seat });
    this.lastDiscard = tile;
    this.lastDiscardSeat = seat;
    this.drawnTile = null;

    const claims = this._checkClaims(tile, seat);
    if (claims.length > 0) {
      this.turnPhase = 'claim';
      this.pendingClaims = {};
      return { action: 'discarded', tile, seat, claims };
    }
    this._advanceTurn();
    return { action: 'discarded', tile, seat, claims: [], nextTurn: this.currentTurn };
  }

  _checkClaims(tile, from) {
    const claims = [];
    for (let s = 0; s < 4; s++) {
      if (s === from) continue;
      const opts = [];
      if (canWinWith(this.hands[s], this.melds[s], tile)) opts.push('win');
      if (canClaimKong(this.hands[s], tile)) opts.push('kong');
      if (canClaimPong(this.hands[s], tile)) opts.push('pong');
      if (s === (from + 1) % 4 && canClaimChow(this.hands[s], tile)) opts.push('chow');
      if (opts.length) claims.push({ seat: s, options: opts });
    }
    return claims;
  }

  submitClaim(seat, type, chowRanks) {
    if (this.turnPhase !== 'claim' || seat === this.lastDiscardSeat) return { error: 'Cannot claim' };
    this.pendingClaims[seat] = { type, chowRanks };
    return { action: 'claim_submitted' };
  }
  passClaim(seat) {
    if (this.turnPhase !== 'claim') return { error: 'Not claim phase' };
    this.pendingClaims[seat] = { type: 'pass' };
    return { ok: true };
  }

  resolveClaims() {
    const PRI = { win: 4, kong: 3, pong: 2, chow: 1, pass: 0 };
    let best = -1, bestP = 0, bestC = null;
    for (const [s, c] of Object.entries(this.pendingClaims)) {
      const p = PRI[c.type] || 0;
      if (p > bestP) { bestP = p; best = +s; bestC = c; }
    }
    if (best === -1 || bestC.type === 'pass') { this._advanceTurn(); return { action: 'no_claims', nextTurn: this.currentTurn }; }
    return this._executeClaim(best, bestC);
  }

  _executeClaim(seat, claim) {
    const tile = this.lastDiscard;
    this.discards[this.lastDiscardSeat].pop();
    this.allDiscards.pop();

    if (claim.type === 'win') {
      this.hands[seat].push(tile);
      this.winScore = scoreHand(this.hands[seat], this.melds[seat]);
      this.state = 'finished'; this.winner = seat;
      return { action: 'win', seat, score: this.winScore };
    }
    if (claim.type === 'kong') {
      const m = this.hands[seat].filter(t => tilesMatch(t, tile)).slice(0, 3);
      this.hands[seat] = this.hands[seat].filter(t => !m.includes(t));
      this.melds[seat].push({ type: 'kong', tiles: [...m, tile], open: true });
      this.currentTurn = seat;
      if (this.deadWall.length) { const b = this.deadWall.pop(); this.hands[seat].push(b); this.drawnTile = b; }
      this.turnPhase = 'discard';
      return { action: 'claimed_kong', seat };
    }
    if (claim.type === 'pong') {
      const m = this.hands[seat].filter(t => tilesMatch(t, tile)).slice(0, 2);
      this.hands[seat] = this.hands[seat].filter(t => !m.includes(t));
      this.melds[seat].push({ type: 'pong', tiles: [...m, tile], open: true });
      this.currentTurn = seat;
      this.turnPhase = 'discard';
      return { action: 'claimed_pong', seat };
    }
    if (claim.type === 'chow') {
      const ranks = claim.chowRanks;
      const needed = ranks.filter(r => r !== tile.rank);
      const chow = [tile];
      for (const r of needed) {
        const i = this.hands[seat].findIndex(t => t.type === 'suited' && t.suit === tile.suit && t.rank === r);
        if (i >= 0) chow.push(this.hands[seat].splice(i, 1)[0]);
      }
      this.melds[seat].push({ type: 'chow', tiles: sortTiles(chow), open: true });
      this.currentTurn = seat;
      this.turnPhase = 'discard';
      return { action: 'claimed_chow', seat };
    }
    return { error: 'Bad claim' };
  }

  declareConcealedKong(seat, tk) {
    if (seat !== this.currentTurn || this.turnPhase !== 'discard') return { error: 'Cannot kong now' };
    const m = this.hands[seat].filter(t => tileKey(t) === tk);
    if (m.length < 4) return { error: 'Need 4 tiles' };
    const k = m.slice(0, 4);
    this.hands[seat] = this.hands[seat].filter(t => !k.includes(t));
    this.melds[seat].push({ type: 'kong', tiles: k, open: false });
    if (this.deadWall.length) { const b = this.deadWall.pop(); this.hands[seat].push(b); this.drawnTile = b; }
    this.turnPhase = 'discard';
    return { action: 'concealed_kong', seat };
  }

  upgradeToKong(seat, tileId) {
    if (seat !== this.currentTurn || this.turnPhase !== 'discard') return { error: 'Cannot upgrade now' };
    const ti = this.hands[seat].findIndex(t => t.id === tileId);
    if (ti === -1) return { error: 'Not in hand' };
    const tile = this.hands[seat][ti];
    const mi = this.melds[seat].findIndex(m => m.type === 'pong' && tilesMatch(m.tiles[0], tile));
    if (mi === -1) return { error: 'No pong to upgrade' };
    this.hands[seat].splice(ti, 1);
    this.melds[seat][mi].tiles.push(tile);
    this.melds[seat][mi].type = 'kong';
    if (this.deadWall.length) { const b = this.deadWall.pop(); this.hands[seat].push(b); this.drawnTile = b; }
    this.turnPhase = 'discard';
    return { action: 'upgrade_kong', seat };
  }

  declareSelfWin(seat) {
    if (seat !== this.currentTurn || this.turnPhase !== 'discard') return { error: 'Cannot win now' };
    if (!isWinningHand(this.hands[seat], this.melds[seat])) return { error: 'Not winning' };
    this.winScore = scoreHand(this.hands[seat], this.melds[seat]);
    this.state = 'finished'; this.winner = seat;
    return { action: 'self_win', seat, score: this.winScore };
  }

  reorderHand(seat, ids) {
    const nh = [];
    for (const id of ids) { const t = this.hands[seat].find(x => x.id === id); if (t) nh.push(t); }
    if (nh.length === this.hands[seat].length) { this.hands[seat] = nh; return true; }
    return false;
  }

  _advanceTurn() {
    this.currentTurn = (this.currentTurn + 1) % 4;
    this.turnPhase = 'draw';
    this.lastDiscard = null;
    this.pendingClaims = {};
  }

  stateFor(seat) {
    return {
      roomId: this.roomId, code: this.code, state: this.state, seat,
      seatWind: SEATS[seat], roundWind: this.roundWind,
      players: this.players.map((p, i) => ({
        name: p ? p.name : null, seat: i, seatWind: SEATS[i],
        connected: p ? p.connected : false, handSize: this.hands[i].length,
        melds: this.melds[i], discards: this.discards[i], isCurrentTurn: i === this.currentTurn
      })),
      hand: this.hands[seat], melds: this.melds[seat],
      currentTurn: this.currentTurn, turnPhase: this.turnPhase,
      wallRemaining: this.wall.length, lastDiscard: this.lastDiscard,
      lastDiscardSeat: this.lastDiscardSeat, allDiscards: this.allDiscards,
      drawnTile: this.drawnTile, winner: this.winner, winScore: this.winScore,
      turnCount: this.turnCount
    };
  }
}

module.exports = { MahjongGame, SEATS };
