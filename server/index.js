// server/index.js — Express + WebSocket server
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { MahjongGame, SEATS } = require('./game');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, '../public')));

const rooms = new Map();
const clients = new Map();
const roomCodes = new Map();

function genCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = ''; for (let i = 0; i < 6; i++) code += ch[Math.floor(Math.random() * ch.length)]; }
  while (roomCodes.has(code));
  return code;
}

function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

function broadcastState(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;
  for (const [ws, c] of clients) {
    if (c.roomId === roomId) send(ws, { type: 'game_state', ...game.stateFor(c.seat) });
  }
}

function broadcastToRoom(roomId, data) {
  for (const [ws, c] of clients) { if (c.roomId === roomId) send(ws, data); }
}

function findWs(roomId, seat) {
  for (const [ws, c] of clients) { if (c.roomId === roomId && c.seat === seat) return ws; }
  return null;
}

wss.on('connection', (ws) => {
  const pid = uuidv4();
  clients.set(ws, { pid, roomId: null, seat: -1 });
  send(ws, { type: 'connected', playerId: pid });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', message: 'Bad JSON' }); }
    const cl = clients.get(ws);
    if (!cl) return;

    try {
      switch (msg.type) {
        case 'create_room': {
          const id = uuidv4(), code = genCode();
          const game = new MahjongGame(id);
          game.code = code;
          const seat = game.addPlayer(cl.pid, msg.name || 'Player');
          rooms.set(id, game); roomCodes.set(code, id);
          cl.roomId = id; cl.seat = seat;
          send(ws, { type: 'room_created', roomId: id, code, seat, seatWind: SEATS[seat],
            players: game.players.map((p, i) => ({ name: p?.name || null, seat: i, seatWind: SEATS[i] })) });
          break;
        }
        case 'join_room': {
          const code = (msg.code || '').toUpperCase().trim();
          const id = roomCodes.get(code);
          if (!id) return send(ws, { type: 'error', message: 'Room not found' });
          const game = rooms.get(id);
          if (!game) return send(ws, { type: 'error', message: 'Room gone' });
          if (game.isFull()) return send(ws, { type: 'error', message: 'Room full' });
          if (game.state === 'playing') return send(ws, { type: 'error', message: 'Game in progress' });
          const seat = game.addPlayer(cl.pid, msg.name || 'Player');
          cl.roomId = id; cl.seat = seat;
          send(ws, { type: 'room_joined', roomId: id, code, seat, seatWind: SEATS[seat] });
          broadcastToRoom(id, { type: 'room_update', players: game.players.map((p, i) => ({
            name: p?.name || null, seat: i, seatWind: SEATS[i], connected: p?.connected || false })), code });
          if (game.isFull()) broadcastToRoom(id, { type: 'room_full' });
          break;
        }
        case 'start_game': {
          const game = rooms.get(cl.roomId);
          if (!game) return send(ws, { type: 'error', message: 'No room' });
          if (!game.isFull()) return send(ws, { type: 'error', message: 'Need 4 players' });
          if (cl.seat !== 0) return send(ws, { type: 'error', message: 'Only host can start' });
          game.startGame();
          broadcastState(cl.roomId);
          break;
        }
        case 'draw': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          const r = game.drawTile(cl.seat);
          if (r.error) return send(ws, { type: 'error', message: r.error });
          broadcastState(cl.roomId);
          break;
        }
        case 'discard': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          const r = game.discard(cl.seat, msg.tileId);
          if (r.error) return send(ws, { type: 'error', message: r.error });
          broadcastState(cl.roomId);
          if (r.claims && r.claims.length > 0) {
            for (const c of r.claims) {
              const cws = findWs(cl.roomId, c.seat);
              if (cws) send(cws, { type: 'claim_available', options: c.options, tile: game.lastDiscard, fromSeat: game.lastDiscardSeat });
            }
            game.claimTimer = setTimeout(() => {
              const eligible = game._checkClaims(game.lastDiscard, game.lastDiscardSeat);
              for (const e of eligible) { if (!game.pendingClaims[e.seat]) game.pendingClaims[e.seat] = { type: 'pass' }; }
              game.resolveClaims();
              broadcastState(cl.roomId);
            }, 10000);
          }
          break;
        }
        case 'claim': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          const r = game.submitClaim(cl.seat, msg.claimType, msg.chowRanks);
          if (r.error) return send(ws, { type: 'error', message: r.error });
          // Check if all responded
          const eligible = game._checkClaims(game.lastDiscard, game.lastDiscardSeat);
          if (Object.keys(game.pendingClaims).length >= eligible.length) {
            if (game.claimTimer) clearTimeout(game.claimTimer);
            game.resolveClaims();
            broadcastState(cl.roomId);
          }
          break;
        }
        case 'pass_claim': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          game.passClaim(cl.seat);
          const eligible = game._checkClaims(game.lastDiscard, game.lastDiscardSeat);
          if (Object.keys(game.pendingClaims).length >= eligible.length) {
            if (game.claimTimer) clearTimeout(game.claimTimer);
            game.resolveClaims();
            broadcastState(cl.roomId);
          }
          break;
        }
        case 'declare_win': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          const r = game.declareSelfWin(cl.seat);
          if (r.error) return send(ws, { type: 'error', message: r.error });
          broadcastState(cl.roomId);
          break;
        }
        case 'concealed_kong': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          const r = game.declareConcealedKong(cl.seat, msg.tileKey);
          if (r.error) return send(ws, { type: 'error', message: r.error });
          broadcastState(cl.roomId);
          break;
        }
        case 'upgrade_kong': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          const r = game.upgradeToKong(cl.seat, msg.tileId);
          if (r.error) return send(ws, { type: 'error', message: r.error });
          broadcastState(cl.roomId);
          break;
        }
        case 'reorder_hand': {
          const game = rooms.get(cl.roomId);
          if (!game) return;
          game.reorderHand(cl.seat, msg.tileIds);
          send(ws, { type: 'game_state', ...game.stateFor(cl.seat) });
          break;
        }
        case 'get_state': {
          const game = rooms.get(cl.roomId);
          if (!game) return send(ws, { type: 'error', message: 'No game' });
          send(ws, { type: 'game_state', ...game.stateFor(cl.seat) });
          break;
        }
      }
    } catch (err) {
      console.error('Handler error:', err);
      send(ws, { type: 'error', message: 'Server error' });
    }
  });

  ws.on('close', () => {
    const cl = clients.get(ws);
    if (cl && cl.roomId) {
      const game = rooms.get(cl.roomId);
      if (game) {
        const s = game.getSeat(cl.pid);
        if (s >= 0 && game.players[s]) {
          game.players[s].connected = false;
          broadcastState(cl.roomId);
        }
      }
    }
    clients.delete(ws);
  });
});

// Cleanup stale rooms
setInterval(() => {
  for (const [id, game] of rooms) {
    if (!game.players.some(p => p?.connected) && game.state !== 'waiting') {
      rooms.delete(id);
      if (game.code) roomCodes.delete(game.code);
    }
  }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🀄 Mahjong server on port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});
