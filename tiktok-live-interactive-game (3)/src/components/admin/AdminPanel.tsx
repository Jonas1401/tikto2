"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GameStage from "@/components/game/GameStage";
import { useGameStream } from "@/components/game/useGameStream";
import type { Snapshot } from "@/lib/game/types";

interface LogLine { id: number; at: string; text: string; ok: boolean }

export default function AdminPanel() {
  const [token, setToken] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const idRef = useRef(1);

  // Form state
  const [extendMs, setExtendMs] = useState(60000);
  const [powerMs, setPowerMs] = useState(60000);
  const [botTeam, setBotTeam] = useState<"red" | "blue">("red");
  const [botName, setBotName] = useState("");
  const [spikerText, setSpikerText] = useState("");
  const [ttUser, setTtUser] = useState("");
  const [ttRoom, setTtRoom] = useState("");
  const [giftName, setGiftName] = useState("");
  const [giftDiamonds, setGiftDiamonds] = useState(10);
  const [giftTeam, setGiftTeam] = useState<"" | "red" | "blue">("");
  const [likes, setLikes] = useState(100);
  const [chatName, setChatName] = useState("");
  const [chatText, setChatText] = useState("1");
  const [joinName, setJoinName] = useState("");
  const [viewers, setViewers] = useState(1250);

  const handlers = useMemo(() => ({}), []);
  const { snapshot, connected } = useGameStream(handlers);

  useEffect(() => {
    const saved = window.localStorage.getItem("towerAdminToken");
    if (saved) setToken(saved);
  }, []);
  useEffect(() => {
    if (snapshot?.tiktok.username && !ttUser) setTtUser(snapshot.tiktok.username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.tiktok.username]);

  const pushLog = useCallback((text: string, ok: boolean) => {
    setLog((l) => [{ id: idRef.current++, at: new Date().toLocaleTimeString(), text, ok }, ...l].slice(0, 40));
  }, []);

  const api = useCallback(
    async (body: Record<string, unknown>) => {
      const action = String(body.action);
      setBusy(action);
      const tok = token.trim() || "admindev";
      window.localStorage.setItem("towerAdminToken", token);
      try {
        const r = await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
          body: JSON.stringify(body),
        });
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        const ok = r.ok && j.ok !== false;
        const detail = Object.entries(j)
          .filter(([k]) => k !== "ok")
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join("  ");
        pushLog(`${action}: ${ok ? "OK" : "FAILED"} ${detail}`, ok);
      } catch (e) {
        pushLog(`${action}: network error ${(e as Error).message}`, false);
      } finally {
        setBusy(null);
      }
    },
    [token, pushLog],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* Live preview */}
      <aside className="space-y-4">
        <div className="panel p-3">
          <h2>Live preview</h2>
          <div className="w-full aspect-[9/16] rounded-xl overflow-hidden [&>.stage]:w-full [&>.stage]:h-full">
            <GameStage compact />
          </div>
        </div>
        <StatusCard snapshot={snapshot} connected={connected} />
      </aside>

      <div className="space-y-4">
        {/* Auth */}
        <section className="panel">
          <h2>Access</h2>
          <label className="label">Admin token (ADMIN_TOKEN env · default <code>admindev</code>)</label>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder="admindev"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button className="btn" disabled={busy !== null} onClick={() => api({ action: "dbSetup" })}>
              🗄 Create DB tables
            </button>
          </div>
          <p className="text-[11px] opacity-60 mt-2">
            Run once after connecting a fresh database (e.g. right after deploying to Vercel).
          </p>
        </section>

        {/* TikTok */}
        <section className="panel">
          <h2>TikTok Live connection</h2>
          <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
            <div>
              <label className="label">Username (without @)</label>
              <input className="input" value={ttUser} onChange={(e) => setTtUser(e.target.value)} placeholder="your_live_account" />
            </div>
            <div>
              <label className="label">Room ID (optional)</label>
              <input className="input" value={ttRoom} onChange={(e) => setTtRoom(e.target.value)} placeholder="7xxxxxxxxxxxxxxxxxx" />
            </div>
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => api({ action: "tiktokConnect", username: ttUser, roomId: ttRoom })}>
              Connect
            </button>
            <button className="btn btn-danger" disabled={busy !== null} onClick={() => api({ action: "tiktokDisconnect" })}>
              Disconnect
            </button>
          </div>
          <p className="text-[11px] opacity-60 mt-2">
            Status: <b className={snapshot?.tiktok.ok ? "text-green-400" : "text-amber-300"}>{snapshot?.tiktok.msg ?? "…"}</b>.
            The account must be live. Set <code>TIKTOK_USERNAME</code> to auto-connect on boot.
          </p>
        </section>

        {/* Match controls */}
        <section className="panel">
          <h2>Match controls</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <Control label="Extend match (ms)">
              <div className="flex gap-2">
                <input className="input" type="number" min={10000} step={1000} value={extendMs} onChange={(e) => setExtendMs(Number(e.target.value))} />
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => api({ action: "extendMatch", ms: extendMs })}>⏱ Extend</button>
              </div>
            </Control>
            <Control label="Power mode duration (ms)">
              <div className="flex gap-2">
                <input className="input" type="number" min={5000} step={1000} value={powerMs} onChange={(e) => setPowerMs(Number(e.target.value))} />
                <button className="btn btn-gold" disabled={busy !== null} onClick={() => api({ action: "powerMode", ms: powerMs })}>⚡ Start</button>
              </div>
            </Control>
            <Control label="Bot soldier">
              <div className="flex gap-2">
                <select className="input" value={botTeam} onChange={(e) => setBotTeam(e.target.value as "red" | "blue")}>
                  <option value="red">Red</option>
                  <option value="blue">Blue</option>
                </select>
                <input className="input" placeholder="Name" maxLength={24} value={botName} onChange={(e) => setBotName(e.target.value)} />
                <button className="btn" disabled={busy !== null} onClick={() => api({ action: "spawnBot", team: botTeam, name: botName || "Support Bot" })}>🤖</button>
              </div>
            </Control>
            <Control label="Commentator message">
              <div className="flex gap-2">
                <input className="input" placeholder="Say something on stream…" maxLength={160} value={spikerText} onChange={(e) => setSpikerText(e.target.value)} />
                <button className="btn" disabled={busy !== null || !spikerText.trim()} onClick={() => { api({ action: "spiker", text: spikerText }); setSpikerText(""); }}>📣</button>
              </div>
            </Control>
            <Control label="Final round (5× damage) — manual">
              <button className="btn btn-red w-full" disabled={busy !== null} onClick={() => api({ action: "suddenDeath" })}>🔥 Activate final round</button>
            </Control>
            <Control label="Reset match now">
              <button className="btn btn-danger w-full" disabled={busy !== null} onClick={() => api({ action: "resetMatch" })}>♻️ Reset towers & scores</button>
            </Control>
          </div>
        </section>

        {/* Simulator */}
        <section className="panel">
          <h2>Simulator — test without a live stream</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <Control label="Gift (name · 💎 diamonds · team)">
              <div className="flex gap-2">
                <input className="input" placeholder="random" value={giftName} onChange={(e) => setGiftName(e.target.value)} />
                <input className="input w-24" type="number" min={1} value={giftDiamonds} onChange={(e) => setGiftDiamonds(Number(e.target.value))} />
                <select className="input w-24" value={giftTeam} onChange={(e) => setGiftTeam(e.target.value as "" | "red" | "blue")}>
                  <option value="">auto</option>
                  <option value="red">red</option>
                  <option value="blue">blue</option>
                </select>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => api({ action: "simGift", name: giftName, diamonds: giftDiamonds, team: giftTeam || undefined })}>🎁 Send</button>
                {[1, 5, 99, 500, 1000].map((d) => (
                  <button key={d} className="btn" disabled={busy !== null} onClick={() => api({ action: "simGift", name: giftName, diamonds: d, team: giftTeam || undefined })}>💎{d}</button>
                ))}
              </div>
            </Control>
            <Control label="Likes">
              <div className="flex gap-2">
                <input className="input" type="number" min={1} max={5000} value={likes} onChange={(e) => setLikes(Number(e.target.value))} />
                <button className="btn btn-gold" disabled={busy !== null} onClick={() => api({ action: "simLikes", count: likes })}>👍 Like</button>
              </div>
            </Control>
            <Control label="Chat (1/red · 2/blue picks a team)">
              <div className="flex gap-2">
                <input className="input" placeholder="name (random)" value={chatName} onChange={(e) => setChatName(e.target.value)} />
                <input className="input" value={chatText} onChange={(e) => setChatText(e.target.value)} />
                <button className="btn" disabled={busy !== null} onClick={() => api({ action: "simChat", name: chatName, comment: chatText })}>💬</button>
              </div>
            </Control>
            <Control label="Viewer join">
              <div className="flex gap-2">
                <input className="input" placeholder="name (random)" value={joinName} onChange={(e) => setJoinName(e.target.value)} />
                <button className="btn" disabled={busy !== null} onClick={() => api({ action: "simJoin", name: joinName })}>🙋 Join</button>
                <button className="btn btn-gold" disabled={busy !== null} onClick={() => api({ action: "simJoin", name: joinName, vip: true })}>⭐ VIP</button>
              </div>
            </Control>
            <Control label="Viewer count">
              <div className="flex gap-2">
                <input className="input" type="number" min={0} value={viewers} onChange={(e) => setViewers(Number(e.target.value))} />
                <button className="btn" disabled={busy !== null} onClick={() => api({ action: "simViewers", count: viewers })}>👁 Set</button>
              </div>
            </Control>
            <Control label="Activity storm (random mix)">
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1" disabled={busy !== null} onClick={() => api({ action: "simBurst", count: 10 })}>🌪 10 events</button>
                <button className="btn btn-primary flex-1" disabled={busy !== null} onClick={() => api({ action: "simBurst", count: 30 })}>🌪 30 events</button>
              </div>
            </Control>
          </div>
        </section>

        {/* Log */}
        <section className="panel">
          <h2>Action log</h2>
          {log.length === 0 && <p className="text-xs opacity-50">No actions yet.</p>}
          <ul className="text-[11px] font-mono space-y-1 max-h-56 overflow-auto">
            {log.map((l) => (
              <li key={l.id} className={l.ok ? "text-green-300" : "text-red-300"}>
                <span className="opacity-50">{l.at}</span> {l.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-3">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function StatusCard({ snapshot, connected }: { snapshot: Snapshot | null; connected: boolean }) {
  const gs = snapshot?.gameState;
  return (
    <div className="panel text-xs space-y-2">
      <h2>Live status</h2>
      <Row k="Event stream" v={connected ? "connected" : "reconnecting…"} ok={connected} />
      <Row k="TikTok" v={snapshot?.tiktok.ok ? `live @${snapshot.tiktok.username}` : snapshot?.tiktok.connecting ? "connecting…" : "offline"} ok={!!snapshot?.tiktok.ok} />
      <Row k="Match" v={gs ? (gs.running ? "running" : `over · ${gs.winner ?? "—"}`) : "—"} ok={!!gs?.running} />
      <Row k="Red HP" v={gs ? `${Math.ceil(gs.red.hp)} / ${gs.red.maxHp}` : "—"} />
      <Row k="Blue HP" v={gs ? `${Math.ceil(gs.blue.hp)} / ${gs.blue.maxHp}` : "—"} />
      <Row k="Power bar" v={snapshot ? `${Math.floor(snapshot.powerBoost.progress)}%` : "—"} />
      <Row k="Bonus pool" v={snapshot ? String(Math.floor(snapshot.bonusPool)) : "—"} />
      <Row k="Chain" v={snapshot ? `${snapshot.comboCount}` : "—"} />
      <Row k="Final round" v={snapshot?.suddenDeath ? "ACTIVE" : "off"} ok={!!snapshot?.suddenDeath} />
      <Row k="Viewers" v={snapshot ? String(snapshot.viewerCount) : "—"} />
    </div>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/5 pb-1">
      <span className="opacity-60">{k}</span>
      <b className={ok === undefined ? "" : ok ? "text-green-400" : "text-amber-300"}>{v}</b>
    </div>
  );
}
