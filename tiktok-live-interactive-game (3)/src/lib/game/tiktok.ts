import { getEngine } from "./engine";
import type { RawTikTokEvent } from "./types";

/** Minimal surface of tiktok-live-connector we rely on (keeps us tolerant to lib typing changes). */
interface LiveConnection {
  connect(roomId?: string): Promise<unknown>;
  disconnect(): Promise<void> | void;
  on(event: string, handler: (payload: RawTikTokEvent) => void): unknown;
}

interface TikTokManagerState {
  conn: LiveConnection | null;
  reconnectTimer: NodeJS.Timeout | null;
  username: string;
  roomId: string;
  desired: boolean; // true while the streamer wants to stay connected
  attempt: number;
}

const g = globalThis as typeof globalThis & { __towerBattleTikTok?: TikTokManagerState };

function state(): TikTokManagerState {
  if (!g.__towerBattleTikTok) {
    g.__towerBattleTikTok = {
      conn: null,
      reconnectTimer: null,
      username: (process.env.TIKTOK_USERNAME || "").trim().replace(/^@/, ""),
      roomId: (process.env.TIKTOK_ROOM_ID || "").trim(),
      desired: false,
      attempt: 0,
    };
  }
  return g.__towerBattleTikTok;
}

export function tiktokInfo() {
  const s = state();
  return { username: s.username, roomId: s.roomId, connected: s.conn != null, desired: s.desired };
}

function clearReconnect() {
  const s = state();
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
}

function scheduleReconnect(delay: number) {
  const s = state();
  clearReconnect();
  if (!s.desired) return;
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    void connectTikTok();
  }, delay);
  s.reconnectTimer.unref?.();
}

export async function disconnectTikTok(): Promise<void> {
  const s = state();
  s.desired = false;
  clearReconnect();
  if (s.conn) {
    try {
      await s.conn.disconnect();
    } catch {
      /* ignore */
    }
    s.conn = null;
  }
  getEngine().setTikTokStatus({ ok: false, connecting: false, msg: "Disconnected.", username: s.username });
}

export async function connectTikTok(opts?: { username?: string; roomId?: string }): Promise<void> {
  const s = state();
  const engine = getEngine();
  if (opts?.username !== undefined) s.username = opts.username.trim().replace(/^@/, "");
  if (opts?.roomId !== undefined) s.roomId = opts.roomId.trim();
  s.desired = true;
  clearReconnect();

  if (s.conn) {
    try {
      await s.conn.disconnect();
    } catch {
      /* ignore */
    }
    s.conn = null;
  }

  if (!s.username) {
    engine.setTikTokStatus({
      ok: false,
      connecting: false,
      username: "",
      msg: "TIKTOK_USERNAME is empty. Set it in the environment or enter it in the streamer panel.",
    });
    s.desired = false;
    return;
  }

  engine.setTikTokStatus({ ok: false, connecting: true, username: s.username, msg: `Connecting to @${s.username}...` });

  let conn: LiveConnection;
  try {
    const mod = (await import("tiktok-live-connector")) as unknown as {
      TikTokLiveConnection: new (uniqueId: string, options?: Record<string, unknown>) => LiveConnection;
      WebcastEvent?: Record<string, string>;
      ControlEvent?: Record<string, string>;
    };
    const Ctor = mod.TikTokLiveConnection;
    conn = new Ctor(s.username, {
      enableExtendedGiftInfo: true,
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
    });

    const ev = mod.WebcastEvent ?? {};
    const ctl = mod.ControlEvent ?? {};
    const GIFT = ev.GIFT ?? "gift";
    const CHAT = ev.CHAT ?? "chat";
    const MEMBER = ev.MEMBER ?? "member";
    const ROOM_USER = ev.ROOM_USER ?? "roomUser";
    const LIKE = ev.LIKE ?? "like";
    const STREAM_END = ev.STREAM_END ?? "streamEnd";
    const ERROR = ctl.ERROR ?? "error";
    const DISCONNECTED = ctl.DISCONNECTED ?? "disconnected";

    conn.on(GIFT, (p) => engine.queueGiftForBatch(p));
    conn.on(CHAT, (p) => engine.handleChat(p));
    conn.on(MEMBER, (p) => engine.handleMemberJoin(p));
    conn.on(ROOM_USER, (p) => engine.handleRoomUser(p));
    conn.on(LIKE, (p) => engine.handleLike(p));
    conn.on(STREAM_END, () => {
      engine.setTikTokStatus({ ok: false, connecting: true, msg: "Stream ended. Reconnecting..." });
      s.conn = null;
      scheduleReconnect(8000);
    });
    conn.on(DISCONNECTED, () => {
      if (!s.desired) return;
      engine.setTikTokStatus({ ok: false, connecting: true, msg: "Connection lost. Reconnecting..." });
      s.conn = null;
      scheduleReconnect(5000);
    });
    conn.on(ERROR, (err) => {
      const e = err as unknown as { message?: string };
      engine.setTikTokStatus({ msg: `Error: ${String(e?.message ?? err)}` });
    });
  } catch (err) {
    engine.setTikTokStatus({
      ok: false,
      connecting: false,
      msg: `tiktok-live-connector failed to load: ${String((err as Error)?.message ?? err)}`,
    });
    s.desired = false;
    return;
  }

  s.conn = conn;
  try {
    await conn.connect(s.roomId || undefined);
    s.attempt = 0;
    engine.setTikTokStatus({ ok: true, connecting: false, username: s.username, msg: "TikTok live connection is ready." });
  } catch (err) {
    const text = String((err as Error)?.message ?? err);
    const offline = /offline|online|not.*live|user_not_found|19881007|UserOffline/i.test(text);
    const hint = offline
      ? " Check the username (without @) and make sure the livestream is active. If needed, set TIKTOK_ROOM_ID."
      : "";
    s.conn = null;
    s.attempt += 1;
    const delay = offline ? 60_000 : Math.min(60_000, 5000 * s.attempt);
    engine.setTikTokStatus({
      ok: false,
      connecting: s.desired,
      msg: `${text}${hint} Retrying in ${Math.round(delay / 1000)}s.`,
    });
    scheduleReconnect(delay);
  }
}

/** Auto-connect once if TIKTOK_USERNAME is configured and we have not tried yet. */
export function ensureAutoConnect(): void {
  // Serverless functions (Vercel) freeze between invocations, so a persistent
  // TikTok listener cannot live there — skip auto-connect and let the panel
  // drive the connection on a persistent host instead.
  if (process.env.VERCEL) return;
  const s = state();
  const auto = (process.env.TIKTOK_AUTOCONNECT ?? "true").toLowerCase() !== "false";
  if (!auto || !s.username || s.desired || s.conn) return;
  void connectTikTok();
}
