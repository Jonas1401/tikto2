import { getEngine, POWER_DURATION_MS } from "@/lib/game/engine";
import { connectTikTok, disconnectTikTok, tiktokInfo } from "@/lib/game/tiktok";
import type { RawTikTokEvent, Team } from "@/lib/game/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admindev";

const DEMO_NAMES = [
  "luna_star", "mike.tv", "sofia_live", "kaan99", "jonas_dev", "nina.k", "pixel_pete", "maria_br",
  "tiger_lee", "ayse_yilmaz", "carlos.rj", "emma_w", "zed_zone", "hana_jp", "ricky.boom", "noor_x",
];

function demoUser(name?: string): RawTikTokEvent {
  const nick = (name && name.trim()) || DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
  const uid = nick.toLowerCase().replace(/[^a-z0-9_.]/g, "_");
  const seed = encodeURIComponent(uid);
  return {
    uniqueId: uid,
    userId: uid,
    nickname: nick,
    profilePictureUrl: `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`,
    followerCount: Math.floor(Math.random() * 90_000),
  };
}

type Body = Record<string, unknown> & { action?: string; token?: string };

function authorized(req: Request, body: Body): boolean {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : String(body.token ?? "");
  return tok === ADMIN_TOKEN;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!authorized(req, body)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  const engine = getEngine();
  const action = String(body.action ?? "");

  try {
    switch (action) {
      // ---------- Database bootstrap (run once on a fresh database, e.g. Vercel) ----------
      case "dbSetup": {
        const { db } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id SERIAL PRIMARY KEY,
  day_key VARCHAR(10) NOT NULL,
  uid VARCHAR(128) NOT NULL,
  nickname VARCHAR(120) NOT NULL DEFAULT 'Player',
  avatar TEXT NOT NULL DEFAULT '',
  damage INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_day_uid_idx ON leaderboard_entries (day_key, uid);
CREATE INDEX IF NOT EXISTS leaderboard_day_damage_idx ON leaderboard_entries (day_key, damage);
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  winner VARCHAR(8) NOT NULL,
  end_reason VARCHAR(16) NOT NULL,
  destroyed_tower VARCHAR(8),
  red_hp INTEGER NOT NULL,
  blue_hp INTEGER NOT NULL,
  red_damage INTEGER NOT NULL DEFAULT 0,
  blue_damage INTEGER NOT NULL DEFAULT 0,
  mvp_uid VARCHAR(128),
  mvp_nickname VARCHAR(120),
  mvp_avatar TEXT,
  bonus_pool INTEGER NOT NULL DEFAULT 0,
  sudden_death BOOLEAN NOT NULL DEFAULT FALSE,
  gift_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gift_events (
  id SERIAL PRIMARY KEY,
  uid VARCHAR(128) NOT NULL,
  nickname VARCHAR(120) NOT NULL DEFAULT 'Player',
  avatar TEXT NOT NULL DEFAULT '',
  team VARCHAR(8) NOT NULL,
  target_tower VARCHAR(8) NOT NULL,
  diamonds INTEGER NOT NULL,
  multiplier INTEGER NOT NULL DEFAULT 1,
  damage INTEGER NOT NULL,
  is_crit BOOLEAN NOT NULL DEFAULT FALSE,
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gift_events_created_idx ON gift_events (created_at);
`));
        return Response.json({ ok: true });
      }
      // ---------- Original streamer actions ----------
      case "extendMatch": {
        const ms = Number(body.ms) || 60_000;
        return Response.json({ ok: true, matchDurationMs: engine.extendMatch(ms) });
      }
      case "spawnBot": {
        const team: Team = body.team === "blue" ? "blue" : "red";
        engine.spawnBot(team, String(body.name || "Support Bot"));
        return Response.json({ ok: true });
      }
      case "powerMode": {
        const ms = Number(body.ms) || POWER_DURATION_MS;
        return Response.json({ ok: true, until: engine.forcePowerMode(ms) });
      }
      case "suddenDeath": {
        engine.activateSuddenDeath();
        return Response.json({ ok: true });
      }
      case "resetMatch": {
        engine.resetMatch();
        return Response.json({ ok: true });
      }
      case "spiker": {
        const text = String(body.text || "").trim().slice(0, 160);
        if (!text) return Response.json({ ok: false, error: "text required" }, { status: 400 });
        engine.emit({ type: "spiker", data: { lines: [text], shake: true } });
        return Response.json({ ok: true });
      }

      // ---------- TikTok connection ----------
      case "tiktokConnect": {
        void connectTikTok({
          username: body.username != null ? String(body.username) : undefined,
          roomId: body.roomId != null ? String(body.roomId) : undefined,
        });
        return Response.json({ ok: true, tiktok: tiktokInfo() });
      }
      case "tiktokDisconnect": {
        await disconnectTikTok();
        return Response.json({ ok: true, tiktok: tiktokInfo() });
      }

      // ---------- Simulator (test the overlay without a live stream) ----------
      case "simGift": {
        const diamonds = Math.max(1, Math.floor(Number(body.diamonds) || 1));
        const team = body.team === "red" || body.team === "blue" ? (body.team as Team) : undefined;
        const user = demoUser(body.name ? String(body.name) : undefined);
        const uid = String(user.uniqueId);
        if (team) engine.handleChat({ ...user, comment: team === "red" ? "1" : "2" });
        const payload = engine.processGift({
          ...user,
          giftName: String(body.giftName || (diamonds <= 1 ? "Rose" : diamonds >= 100 ? "Magic Wand" : "Gift")),
          diamondCount: diamonds,
          repeatCount: 1,
          repeatEnd: true,
          _simulated: true,
        });
        if (!payload) {
          return Response.json({ ok: false, error: engine.gameState.running ? "Rate limited - try again" : "Match is over, wait for reset" });
        }
        return Response.json({
          ok: true,
          uid,
          team: payload.team,
          damage: payload.damage,
          multiplier: payload.totalMultiplier,
          crit: payload.isCrit,
        });
      }
      case "simLikes": {
        const n = Math.max(1, Math.min(5000, Math.floor(Number(body.count) || 50)));
        engine.addLikes(n);
        return Response.json({ ok: true, count: n });
      }
      case "simChat": {
        const user = demoUser(body.name ? String(body.name) : undefined);
        const comment = String(body.comment ?? "1").slice(0, 120);
        engine.handleChat({ ...user, comment });
        return Response.json({ ok: true, team: engine.getTeam(String(user.uniqueId)) });
      }
      case "simJoin": {
        const user = demoUser(body.name ? String(body.name) : undefined);
        if (body.vip) user.followerCount = 120_000;
        engine.handleMemberJoin(user);
        return Response.json({ ok: true });
      }
      case "simViewers": {
        engine.setViewerCount(Number(body.count) || 0);
        return Response.json({ ok: true });
      }
      case "simBurst": {
        // A quick storm of random activity for demos.
        const n = Math.max(1, Math.min(30, Math.floor(Number(body.count) || 8)));
        let i = 0;
        const tick = () => {
          if (i >= n) return;
          i += 1;
          const r = Math.random();
          const user = demoUser();
          if (r < 0.45) {
            const d = [1, 1, 5, 10, 20, 99, 100, 500][Math.floor(Math.random() * 8)];
            engine.processGift({ ...user, diamondCount: d, repeatCount: 1, repeatEnd: true, _simulated: true });
          } else if (r < 0.7) engine.handleMemberJoin(user);
          else if (r < 0.85) engine.handleChat({ ...user, comment: Math.random() < 0.5 ? "1" : "2" });
          else engine.addLikes(20 + Math.floor(Math.random() * 120));
          setTimeout(tick, 250 + Math.random() * 400);
        };
        tick();
        return Response.json({ ok: true, count: n });
      }
      default:
        return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
