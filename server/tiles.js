// server/tiles.js — Tile set, fair shuffle, meld & win logic

const SUITS = ['bamboo', 'circles', 'characters'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const WINDS = ['east', 'south', 'west', 'north'];
const DRAGONS = ['red', 'green', 'white'];

function createFullTileSet() {
  const tiles = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      for (let c = 0; c < 4; c++) tiles.push({ id: id++, suit, rank, type: 'suited' });
    }
  }
  for (const wind of WINDS) {
    for (let c = 0; c < 4; c++) tiles.push({ id: id++, name: wind, type: 'wind' });
  }
  for (const dragon of DRAGONS) {
    for (let c = 0; c < 4; c++) tiles.push({ id: id++, name: dragon, type: 'dragon' });
  }
  return tiles; // 136 total
}

// Fisher-Yates — uniform random, same odds as physical tile shuffling
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tileKey(t) {
  return t.type === 'suited' ? `${t.suit}-${t.rank}` : `${t.type}-${t.name}`;
}
function tilesMatch(a, b) { return tileKey(a) === tileKey(b); }

function tileSortVal(t) {
  if (t.type === 'suited') return SUITS.indexOf(t.suit) * 100 + t.rank;
  if (t.type === 'wind') return 300 + WINDS.indexOf(t.name);
  return 400 + DRAGONS.indexOf(t.name);
}
function sortTiles(tiles) { return [...tiles].sort((a, b) => tileSortVal(a) - tileSortVal(b)); }

function countByKey(tiles) {
  const c = {};
  for (const t of tiles) { const k = tileKey(t); c[k] = (c[k] || 0) + 1; }
  return c;
}

// ─── Meld helpers ─────────────────────────────────────────
function canDecomposeMelds(tiles) {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;
  const sorted = sortTiles(tiles);
  const first = sorted[0];

  // Try triplet
  const sameIdx = [];
  for (let i = 1; i < sorted.length; i++) {
    if (tilesMatch(sorted[i], first)) sameIdx.push(i);
  }
  if (sameIdx.length >= 2) {
    const rem = sorted.filter((_, i) => i !== 0 && i !== sameIdx[0] && i !== sameIdx[1]);
    if (canDecomposeMelds(rem)) return true;
  }

  // Try sequence (suited only)
  if (first.type === 'suited') {
    const s = first.suit, r = first.rank;
    const i2 = sorted.findIndex((t, i) => i > 0 && t.type === 'suited' && t.suit === s && t.rank === r + 1);
    if (i2 >= 0) {
      const i3 = sorted.findIndex((t, i) => i > i2 && t.type === 'suited' && t.suit === s && t.rank === r + 2);
      if (i3 >= 0) {
        const rem = sorted.filter((_, i) => i !== 0 && i !== i2 && i !== i3);
        if (canDecomposeMelds(rem)) return true;
      }
    }
  }
  return false;
}

function isWinningHand(hand, melds = []) {
  const meldCount = melds.length;
  const needed = 4 - meldCount;

  // Standard: find a pair, decompose rest into melds
  const counts = countByKey(hand);
  for (const pk of Object.keys(counts)) {
    if (counts[pk] < 2) continue;
    let rem = [...hand], removed = 0;
    rem = rem.filter(t => { if (removed < 2 && tileKey(t) === pk) { removed++; return false; } return true; });
    if (rem.length === needed * 3 && canDecomposeMelds(rem)) return true;
  }

  // Seven Pairs
  if (meldCount === 0 && hand.length === 14) {
    const vals = Object.values(counts);
    if (vals.length === 7 && vals.every(v => v === 2)) return true;
  }

  // Thirteen Orphans
  if (meldCount === 0 && hand.length === 14) {
    const req = ['bamboo-1','bamboo-9','circles-1','circles-9','characters-1','characters-9',
      'wind-east','wind-south','wind-west','wind-north','dragon-red','dragon-green','dragon-white'];
    const keys = hand.map(t => tileKey(t));
    if (req.every(r => keys.includes(r))) return true;
  }

  return false;
}

function canWinWith(hand, melds, newTile) {
  return isWinningHand([...hand, newTile], melds);
}

// ─── Claim checks ─────────────────────────────────────────
function canClaimPong(hand, tile) {
  return hand.filter(t => tilesMatch(t, tile)).length >= 2;
}
function canClaimKong(hand, tile) {
  return hand.filter(t => tilesMatch(t, tile)).length >= 3;
}
function canClaimChow(hand, tile) {
  if (tile.type !== 'suited') return false;
  const rs = hand.filter(t => t.type === 'suited' && t.suit === tile.suit).map(t => t.rank);
  const r = tile.rank;
  return (rs.includes(r-2) && rs.includes(r-1)) ||
         (rs.includes(r-1) && rs.includes(r+1)) ||
         (rs.includes(r+1) && rs.includes(r+2));
}
function getChowOptions(hand, tile) {
  if (tile.type !== 'suited') return [];
  const s = tile.suit, r = tile.rank;
  const rs = hand.filter(t => t.type === 'suited' && t.suit === s).map(t => t.rank);
  const opts = [];
  if (rs.includes(r-2) && rs.includes(r-1)) opts.push([r-2, r-1, r]);
  if (rs.includes(r-1) && rs.includes(r+1)) opts.push([r-1, r, r+1]);
  if (rs.includes(r+1) && rs.includes(r+2)) opts.push([r, r+1, r+2]);
  return opts;
}
function getConcealedKongs(hand) {
  const counts = countByKey(hand);
  const kongs = [];
  for (const [k, c] of Object.entries(counts)) {
    if (c >= 4) kongs.push(hand.filter(t => tileKey(t) === k).slice(0, 4));
  }
  return kongs;
}

// ─── Scoring ──────────────────────────────────────────────
function scoreHand(hand, melds) {
  const all = [...hand, ...melds.flatMap(m => m.tiles)];
  const checks = [
    { name:'Thirteen Orphans', pts:13, fn: () => melds.length===0 && hand.length===14 && (() => {
      const req = ['bamboo-1','bamboo-9','circles-1','circles-9','characters-1','characters-9',
        'wind-east','wind-south','wind-west','wind-north','dragon-red','dragon-green','dragon-white'];
      return req.every(r => hand.some(t => tileKey(t) === r));
    })() },
    { name:'All Honors', pts:10, fn: () => all.every(t => t.type==='wind'||t.type==='dragon') },
    { name:'All Terminals', pts:10, fn: () => all.every(t => t.type==='suited'&&(t.rank===1||t.rank===9)) },
    { name:'Full Flush', pts:6, fn: () => {
      if (all.some(t => t.type!=='suited')) return false;
      return new Set(all.map(t=>t.suit)).size===1;
    }},
    { name:'Seven Pairs', pts:4, fn: () => melds.length===0 && hand.length===14 && Object.values(countByKey(hand)).length===7 && Object.values(countByKey(hand)).every(v=>v===2) },
    { name:'Half Flush', pts:3, fn: () => {
      const suited = all.filter(t=>t.type==='suited');
      return suited.length>0 && new Set(suited.map(t=>t.suit)).size===1;
    }},
    { name:'Chicken Hand', pts:1, fn: () => true }
  ];
  for (const c of checks) { if (c.fn()) return { name:c.name, points:c.pts }; }
  return { name:'Chicken Hand', points:1 };
}

module.exports = {
  SUITS, RANKS, WINDS, DRAGONS,
  createFullTileSet, shuffle, tileKey, tilesMatch, sortTiles, tileSortVal,
  countByKey, isWinningHand, canWinWith, scoreHand,
  canClaimPong, canClaimKong, canClaimChow, getChowOptions, getConcealedKongs
};
