# 🀄 Mahjong Multiplayer

Traditional 4-player Mahjong with real-time online multiplayer. Create a room, share the 6-letter code with 3 friends, and play.

## Features

- **Room codes** — Create a game and get a 6-letter code to share with friends
- **Real-time gameplay** — WebSocket-powered, instant updates for all players
- **Full Mahjong rules** — Draw, discard, Pong, Kong, Chow, and win detection
- **Fair odds** — Fisher-Yates shuffle ensures statistically identical odds to physical play
- **Drag to reorder** — Organize your hand however you like
- **Claim system** — When a tile is discarded, eligible players can claim it (with priority: Win > Kong > Pong > Chow)
- **Win detection** — Standard 4 melds + pair, Seven Pairs, Thirteen Orphans
- **Scoring** — Chicken Hand, Half Flush, Full Flush, All Honors, All Terminals, and more

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open in browser
# http://localhost:3000
```

All 4 players connect to the same URL. One person creates a room and shares the code.

## How to Play

1. One player clicks **Create Room** and gets a 6-letter code
2. Share the code with 3 friends — they click **Join Room** and enter it
3. Once all 4 players have joined, the host clicks **Start Game**
4. East (seat 0) goes first with 14 tiles and must discard
5. Play proceeds counter-clockwise: Draw → Discard → (Claims) → Next player
6. Click a tile once to select it, click again to discard
7. When someone discards, you may get Pong/Kong/Chow/Win options
8. First player to complete 4 melds + 1 pair (14 tiles) wins!

## Deploy to the Cloud

### Option A: Render (Free tier available)
1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Settings: **Build Command**: `npm install` | **Start Command**: `npm start`
5. That's it! Share the URL with friends

### Option B: Railway
1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js — just deploy
4. Add a domain under Settings → Networking

### Option C: Fly.io
```bash
# Install flyctl, then:
fly launch
fly deploy
```

### Option D: Any VPS (DigitalOcean, Linode, etc.)
```bash
git clone <your-repo>
cd mahjong-multiplayer
npm install
PORT=3000 node server/index.js

# Use nginx as reverse proxy for HTTPS + WebSocket support
```

### Option E: Docker
```bash
docker build -t mahjong .
docker run -p 3000:3000 mahjong
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port |

## Project Structure

```
mahjong-multiplayer/
├── server/
│   ├── index.js    # Express + WebSocket server, room management
│   ├── game.js     # Game state, turns, claims, win logic
│   └── tiles.js    # Tile set, shuffle, meld/win detection, scoring
├── public/
│   └── index.html  # Complete client (lobby + game table)
├── package.json
├── Dockerfile
└── README.md
```

## Coming Soon

- 🤖 Single Player mode with AI opponents
- 📖 Learn mode with interactive tutorial
- 🏆 Extended scoring with more winning hand patterns
