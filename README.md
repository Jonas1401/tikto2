# Live Tower Battle — Next.js + PostgreSQL port

Interactive TikTok Live stream game where viewers drive a real-time **Red vs Blue tower battle**.
This is a full-stack port of [Jonas1401/tiktok_live_interactive_game2](https://github.com/Jonas1401/tiktok_live_interactive_game2)
(originally Express + Socket.IO + vanilla JS + a JSON file) to **Next.js (App Router), Drizzle ORM and PostgreSQL**.

## What changed in the port

| Original                         | This project                                                      |
| -------------------------------- | ----------------------------------------------------------------- |
| `server.js` game engine          | `src/lib/game/engine.ts` (singleton, same tunables & formulas)     |
| Socket.IO broadcasting           | Server-Sent Events: `GET /api/events`                              |
| `data/leaderboard.json`          | PostgreSQL tables `leaderboard_entries`, `matches`, `gift_events`  |
| `public/game.js` canvas renderer | `src/components/game/ArenaScene.ts` + `GameStage.tsx` (React HUD)  |
| `public/admin.html`              | `/admin` streamer panel with live preview **and a simulator**      |
| —                                | `/history` page: match history, daily leaders, gift log            |
| —                                | Timer now ends the match (higher HP wins, draw on tie)             |

## Gameplay (unchanged rules)

- Gifts → damage to the **enemy** tower: `diamonds × wheel multiplier (1/2/5/10/50/100) × power(2) × final-round(5) × chain(1.2)`, 5 % crit chance (×2).
- Likes fill the **power bar**; when full, 60 s **Power Mode** (all damage ×2).
- Chat `1`/`red` or `2`/`blue` picks a team and spawns a soldier; joins trigger welcome effects (VIP for big followers / spenders).
- 5 consecutive gifts from the same team = **team chain** (+20 %). Last minute of the match = **double wheel**.
- 1 % of diamonds feed the **match bonus** shown to the match star when a tower falls.

## Routes

| Route              | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `/`                | 9:16 game overlay (use `?clean=1` for OBS, `?compact=1` to hide hints) |
| `/admin`           | Streamer panel: TikTok connect, match controls, simulator, log      |
| `/history`         | Persistent stats, daily leaderboard, matches, gift strikes          |
| `GET /api/events`  | SSE stream (`init`, `state`, `giftStrike`, `likeBurst`, `powerMode`, `viewerJoin`, `soldier`, `spiker`, `gameOver`, `gameReset`, …) |
| `GET /api/state`   | Current snapshot (JSON)                                             |
| `GET /api/leaderboard` | Top 10 of today                                                 |
| `GET /api/history` | Recent matches, gifts and aggregate stats                           |
| `POST /api/admin`  | Admin actions (see below)                                           |

### Admin API

Auth: `Authorization: Bearer <ADMIN_TOKEN>` header or `token` JSON field (default token `admindev`).

Actions: `extendMatch {ms}`, `spawnBot {team,name}`, `powerMode {ms}`, `suddenDeath`, `resetMatch`, `spiker {text}`,
`tiktokConnect {username,roomId}`, `tiktokDisconnect`,
simulator: `simGift {name,diamonds,team}`, `simLikes {count}`, `simChat {name,comment}`, `simJoin {name,vip}`, `simViewers {count}`, `simBurst {count}`.

```bash
curl -X POST http://localhost:3000/api/admin \
  -H "Content-Type: application/json" -H "Authorization: Bearer admindev" \
  -d '{"action":"simGift","name":"luna_star","diamonds":500,"team":"red"}'
```

## Environment variables

| Variable             | Default      | Purpose                                                   |
| -------------------- | ------------ | --------------------------------------------------------- |
| `DATABASE_URL`       | local pg     | PostgreSQL connection                                     |
| `ADMIN_TOKEN`        | `admindev`   | Streamer panel / admin API token — change in production   |
| `TIKTOK_USERNAME`    | —            | TikTok account to listen to (without `@`); auto-connects  |
| `TIKTOK_ROOM_ID`     | —            | Optional explicit room id                                 |
| `TIKTOK_AUTOCONNECT` | `true`       | Set `false` to connect only from the panel                |

Without a TikTok username the app runs in **simulator mode** — use the `/admin` panel to fire gifts, likes, chats and joins.

## Development

```bash
npm install
npx drizzle-kit push   # create tables
npm run dev
```

## Deploy to Vercel

1. Push this project to GitHub and **Import** it in Vercel. Use the **Next.js** framework preset and leave **Root Directory** empty (`./`), because `package.json` is at the repository root.
2. Add a database: **Storage → Create → Postgres** (or connect a Neon database). This exposes
   `POSTGRES_URL` (or `DATABASE_URL`) to the app automatically. The app can build and run in simulator mode without a database, but history and persistent rankings require one.
3. Set environment variables in **Settings → Environment Variables**:
   - `ADMIN_TOKEN` — a strong streamer token (the app default is `admindev`).
   - `TIKTOK_USERNAME` — optional (see the note below).
4. Deploy, then open `https://<your-app>.vercel.app/admin` and click **🗄 Create DB tables** once.
5. Open `/` for the overlay, `/admin` for the streamer panel, `/history` for stats.

If this Vercel project was configured before the app moved to the repository root, go to **Settings → Build and Deployment → Root Directory**, clear the previous nested directory, and redeploy.

Notes / limitations on Vercel:

- Serverless functions freeze between invocations, so the in-memory match engine is **best-effort**
  there: all functions are pinned to a single region (`vercel.json`) so the overlay and the panel
  normally share one warm instance, and the SSE stream transparently reconnects every ~60 s
  (Hobby limit) with a fresh snapshot. Low-traffic usage (one streamer + overlay) works well.
- The **persistent TikTok Live listener needs an always-on server** — it cannot run 24/7 on
  serverless. On Vercel, use the admin **simulator** to drive the overlay, or deploy the same
  codebase to a persistent host (Render, Railway, Fly.io, a VPS — `npm run build && npm start`
  with `DATABASE_URL` + `TIKTOK_USERNAME` set) for the full TikTok-driven experience.
