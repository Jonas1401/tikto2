"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contributor, GameEvent, GiftStrikePayload, Snapshot, Team } from "@/lib/game/types";
import { ArenaScene, formatDamage, truncate } from "./arenaScene";
import { useGameStream } from "./useGameStream";

type GameOverData = Extract<GameEvent, { type: "gameOver" }>["data"];
type ViewerJoinData = Extract<GameEvent, { type: "viewerJoin" }>["data"];
type ChatData = Extract<GameEvent, { type: "chat" }>["data"];

interface KillLine { id: number; text: string; crit: boolean }
interface ChatLine { id: number; name: string; team: Team; text: string }

const GIFT_CARD_MS = 2600;
const COMBO_THRESHOLD = 5;

export default function GameStage({ compact = false }: { compact?: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudTopRef = useRef<HTMLDivElement>(null);
  const hudBottomRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ArenaScene | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [gift, setGift] = useState<GiftStrikePayload | null>(null);
  const [giftPhase, setGiftPhase] = useState<"spin" | "reveal">("spin");
  const giftQueue = useRef<GiftStrikePayload[]>([]);
  const giftBusy = useRef(false);
  const [welcome, setWelcome] = useState<ViewerJoinData | null>(null);
  const [vipBanner, setVipBanner] = useState<string | null>(null);
  const [spiker, setSpiker] = useState<string[] | null>(null);
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [bonusWin, setBonusWin] = useState<{ amount: number; name: string } | null>(null);
  const [critFlash, setCritFlash] = useState(false);
  const [showLeaders, setShowLeaders] = useState(false);
  const [killFeed, setKillFeed] = useState<KillLine[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const idRef = useRef(1);

  // ---------- Gift queue ----------
  const drainGifts = useCallback(function processNextGift() {
    if (giftBusy.current) return;
    const next = giftQueue.current.shift();
    if (!next) return;
    giftBusy.current = true;
    setGift(next);
    setGiftPhase("spin");
    setTimeout(() => setGiftPhase("reveal"), 900);
    setTimeout(() => {
      setGift(null);
      giftBusy.current = false;
      processNextGift();
    }, GIFT_CARD_MS);
  }, []);

  const handlers = useMemo(
    () => ({
      init: (d: Snapshot) => {
        const s = sceneRef.current;
        if (s) {
          s.gameState = d.gameState;
          s.suddenDeath = d.suddenDeath;
          s.powerUntil = d.powerBoost.activeUntil;
        }
      },
      state: (d: Extract<GameEvent, { type: "state" }>["data"]) => {
        const s = sceneRef.current;
        if (s) {
          s.gameState = d.gameState;
          s.suddenDeath = d.suddenDeath;
          s.powerUntil = d.powerBoost.activeUntil;
        }
      },
      giftStrike: (d: GiftStrikePayload) => {
        const s = sceneRef.current;
        if (s) {
          s.gameState = d.gameState;
          s.loadImage(d.user.avatar).then((img) =>
            s.strike({ team: d.team, target: d.targetTower, damage: d.damage, crit: d.isCrit, mult: d.totalMultiplier, img }),
          );
        }
        if (d.isCrit) {
          setCritFlash(true);
          setTimeout(() => setCritFlash(false), 320);
        }
        if (d.killFeed) {
          const k = d.killFeed;
          const line: KillLine = {
            id: idRef.current++,
            text: `${truncate(k.nickname, 14)} → ${k.targetLabel} tower  −${formatDamage(k.damage)}${k.mult > 1 ? ` (x${k.mult})` : ""}${k.isCrit ? " · CRIT" : ""}`,
            crit: k.isCrit,
          };
          setKillFeed((f) => [line, ...f].slice(0, 5));
        }
        giftQueue.current.push(d);
        if (giftQueue.current.length > 6) giftQueue.current.splice(0, giftQueue.current.length - 6);
        drainGifts();
      },
      likeBurst: (d: { count: number; powerProgress: number }) => sceneRef.current?.likeBurst(d.count),
      powerMode: (d: { until: number }) => {
        if (sceneRef.current) sceneRef.current.powerUntil = d.until;
        setSpiker(["⚡ POWER MODE! All support counts DOUBLE for 60 seconds!"]);
        setTimeout(() => setSpiker(null), 4000);
      },
      viewerJoin: (d: ViewerJoinData) => {
        setWelcome(d);
        setTimeout(() => setWelcome((w) => (w === d ? null : w)), 1800);
        if (d.vip) {
          setVipBanner(`⭐ VIP SUPPORTER · ${d.user.nickname.toUpperCase()}`);
          setTimeout(() => setVipBanner(null), 3800);
        }
        const s = sceneRef.current;
        s?.loadImage(d.user.avatar).then((img) => s.join(d.user.nickname, img, d.team, d.vip));
      },
      soldier: (d: Extract<GameEvent, { type: "soldier" }>["data"]) => {
        if (d.fromGift) return; // already spawned by strike()
        const s = sceneRef.current;
        s?.loadImage(d.user.avatar).then((img) => s.spawnSoldier(d.team, d.user.nickname, img, d.bot));
      },
      spiker: (d: { lines: string[] }) => {
        setSpiker(d.lines);
        setTimeout(() => setSpiker(null), 5200);
      },
      chat: (d: ChatData) => {
        setChat((c) =>
          [...c, { id: idRef.current++, name: d.user.nickname, team: d.team, text: d.comment }].slice(-5),
        );
      },
      gameOver: (d: GameOverData) => {
        if (sceneRef.current) sceneRef.current.gameState = d.gameState;
        setGameOver(d);
        sceneRef.current?.celebrate(180, d.winner === "red" ? 330 : d.winner === "blue" ? 180 : undefined);
      },
      bonusPoolWin: (d: { amount: number; mvp: { nickname: string } | null }) => {
        if (d.amount <= 0) return;
        setBonusWin({ amount: d.amount, name: d.mvp?.nickname || "Standout" });
        setTimeout(() => setBonusWin(null), 6500);
      },
      gameReset: (d: Snapshot) => {
        const s = sceneRef.current;
        if (s) {
          s.gameState = d.gameState;
          s.suddenDeath = false;
          s.powerUntil = 0;
          s.resetMatchVisuals();
        }
        setGameOver(null);
        setKillFeed([]);
        if (d.leaderboardTop.length) {
          setShowLeaders(true);
          setTimeout(() => setShowLeaders(false), 9000);
        }
      },
      suddenDeath: (d: { active: boolean }) => {
        if (sceneRef.current) sceneRef.current.suddenDeath = d.active;
        if (d.active) {
          setSpiker(["🔥 FINAL ROUND! Every gift hits 5x harder!"]);
          setTimeout(() => setSpiker(null), 4500);
        }
      },
    }),
    [drainGifts],
  );

  const { snapshot, connected } = useGameStream(handlers);

  // ---------- Scene lifecycle ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const scene = new ArenaScene(canvas);
    sceneRef.current = scene;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      scene.resize(Math.round(r.width), Math.round(r.height));
      scene.hudTop = hudTopRef.current?.getBoundingClientRect().height ?? 0;
      scene.hudBottom = hudBottomRef.current?.getBoundingClientRect().height ?? 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    if (hudTopRef.current) ro.observe(hudTopRef.current);
    if (hudBottomRef.current) ro.observe(hudBottomRef.current);
    scene.start();
    return () => {
      ro.disconnect();
      scene.stop();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Keep the canvas scene in sync with the React snapshot (robust to scene re-creation).
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !snapshot) return;
    s.gameState = snapshot.gameState;
    s.suddenDeath = snapshot.suddenDeath;
    s.powerUntil = snapshot.powerBoost.activeUntil;
  }, [snapshot]);

  // ---------- Derived HUD values ----------
  const gs = snapshot?.gameState;
  const hpRed = gs ? gs.red.hp / gs.red.maxHp : 1;
  const hpBlue = gs ? gs.blue.hp / gs.blue.maxHp : 1;
  const powerOn = !!snapshot && now < snapshot.powerBoost.activeUntil;
  const powerLeft = snapshot ? Math.max(0, Math.ceil((snapshot.powerBoost.activeUntil - now) / 1000)) : 0;
  const timeLeft = snapshot ? Math.max(0, snapshot.matchDurationMs - (now - snapshot.gameStartedAt)) : 0;
  const finalMinute = !!snapshot && gs?.running && timeLeft <= 60_000;
  const timerText = !gs?.running
    ? "—"
    : snapshot?.suddenDeath
      ? "FINAL"
      : `${String(Math.floor(timeLeft / 60000)).padStart(2, "0")}:${String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, "0")}`;
  const combo = snapshot?.comboCount ?? 0;

  return (
    <div
      ref={stageRef}
      className={`stage relative overflow-hidden select-none ${powerOn ? "stage-power" : ""} ${snapshot?.suddenDeath ? "stage-sd" : ""}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-hidden />

      {/* Screen overlays */}
      <div className={`crit-flash ${critFlash ? "on" : ""}`} aria-hidden />
      {snapshot?.suddenDeath && <div className="sd-overlay" aria-hidden />}

      {/* ---------- TOP HUD ---------- */}
      <div ref={hudTopRef} className="absolute left-0 right-0 top-0 z-10 p-2 pt-2.5 flex flex-col gap-1.5 pointer-events-none">
        <div className="flex items-start gap-2">
          {!compact && (
            <div className="hint-panel flex-1">
              <div>👍 <b>Likes</b> fill the power bar → short <b>2× POWER MODE</b></div>
              <div>💬 Type <kbd>1</kbd> for <b className="text-red">RED</b>, <kbd>2</kbd> for <b className="text-blue">BLUE</b></div>
              <div className="opacity-70 text-[9px] leading-tight">🎁 Gifts hit the enemy tower with a random multiplier · Team chain of 5 grants +20% · Last minute = double wheel</div>
            </div>
          )}
          <div className="flex flex-col items-end gap-1 ml-auto">
            <div className={`match-timer ${finalMinute ? "final" : ""} ${snapshot?.suddenDeath ? "sd" : ""}`}>{timerText}</div>
            {(snapshot?.viewerCount ?? 0) > 0 && <div className="viewer-badge">👁 {snapshot?.viewerCount.toLocaleString()}</div>}
          </div>
        </div>

        <div className="hud-card">
          <div className="grid grid-cols-2 gap-2">
            <TeamBlock team="red" ratio={hpRed} hp={gs?.red.hp ?? 0} captain={gs?.red.captain ?? null} top={snapshot?.teamTop.red ?? []} total={snapshot?.teamTotals.red ?? 0} />
            <TeamBlock team="blue" ratio={hpBlue} hp={gs?.blue.hp ?? 0} captain={gs?.blue.captain ?? null} top={snapshot?.teamTop.blue ?? []} total={snapshot?.teamTotals.blue ?? 0} />
          </div>

          <div className="mt-1.5">
            <div className="power-bar">
              <div className={`power-fill ${powerOn ? "active" : ""}`} style={{ width: powerOn ? "100%" : `${snapshot?.powerBoost.progress ?? 0}%` }} />
            </div>
            <div className="power-label">
              {powerOn ? `⚡ POWER MODE ACTIVE · 2× · ${powerLeft}s` : `⚡ POWER BAR — LIKES & LIVE INTERACTION · ${Math.floor(snapshot?.powerBoost.progress ?? 0)}%`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1.5">
            <div className="stat-cell">
              <div className="mini-label">🏆 MATCH BONUS</div>
              <div className="stat-value">{Math.floor(snapshot?.bonusPool ?? 0)}</div>
              <div className="pool-hint">Score for standout supporters at match end</div>
            </div>
            <div className="stat-cell">
              <div className="mini-label">🔗 TEAM CHAIN {combo >= COMBO_THRESHOLD ? "· +20% ACTIVE" : ""}</div>
              <div className="combo-bar">
                <div className={`combo-fill ${combo >= COMBO_THRESHOLD ? "active" : ""}`} style={{ width: `${Math.min(100, (combo / COMBO_THRESHOLD) * 100)}%` }} />
              </div>
              <div className="pool-hint">{Math.min(combo, COMBO_THRESHOLD)} / {COMBO_THRESHOLD} consecutive same-team gifts</div>
            </div>
          </div>
        </div>
      </div>

      {/* Kill feed */}
      <div className="kill-feed">
        {killFeed.map((k) => (
          <div key={k.id} className={`kill-line ${k.crit ? "crit" : ""}`}>{k.text}</div>
        ))}
      </div>

      {/* Welcome / VIP */}
      {welcome && (
        <div className="welcome-overlay">
          {welcome.user.avatar ? <img src={welcome.user.avatar} alt="" /> : <div className="avatar-fallback">👋</div>}
          <div>
            <div className="welcome-title">{welcome.vip ? "⭐ " : ""}WELCOME {truncate(welcome.user.nickname, 16).toUpperCase()}!</div>
            <div className={`welcome-sub ${welcome.team}`}>joined team {welcome.team.toUpperCase()}</div>
          </div>
        </div>
      )}
      {vipBanner && <div className="vip-banner">{vipBanner}</div>}

      {/* Gift card */}
      {gift && <GiftCard gift={gift} phase={giftPhase} />}

      {/* Commentator */}
      {spiker && (
        <div className="spiker">
          {spiker.map((l, i) => (
            <div key={i} className="line">{l}</div>
          ))}
        </div>
      )}

      {/* Bonus celebration */}
      {bonusWin && (
        <div className="bonus-celebration">
          <div>⭐ MATCH BONUS</div>
          <div className="amount">{bonusWin.amount}</div>
          <div className="who">{bonusWin.name}</div>
        </div>
      )}

      {/* Game over */}
      {gameOver && <GameOverPanel data={gameOver} />}

      {/* Daily leaders */}
      {showLeaders && snapshot && snapshot.leaderboardTop.length > 0 && (
        <div className="leaders-panel">
          <div className="leaders-title">🏅 DAILY LEADERS</div>
          <ol>
            {snapshot.leaderboardTop.map((e, i) => (
              <li key={e.uid}>
                <span>{i + 1}. {truncate(e.nickname, 16)}</span>
                <b>{formatDamage(e.damage)}</b>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ---------- BOTTOM HUD ---------- */}
      <div ref={hudBottomRef} className="absolute left-0 right-0 bottom-0 z-10 p-2 flex flex-col gap-1 pointer-events-none">
        {chat.length > 0 && (
          <div className="chat-ticker">
            {chat.map((c) => (
              <div key={c.id} className="chat-line">
                <span className={`chat-name ${c.team}`}>{truncate(c.name, 14)}</span> {c.text}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className={`status-pill ${snapshot?.tiktok.ok ? "ok" : snapshot?.tiktok.connecting ? "warn" : ""}`}>
            <span className="dot" />
            {snapshot
              ? snapshot.tiktok.ok
                ? `LIVE · @${snapshot.tiktok.username}`
                : snapshot.tiktok.connecting
                  ? "TikTok: connecting…"
                  : "TikTok: offline · simulator mode"
              : connected
                ? "Syncing…"
                : "Connecting to game server…"}
          </div>
          <div className="legal">Entertainment only · no real-money gameplay</div>
        </div>
      </div>
    </div>
  );
}

// ---------- Sub components ----------

function TeamBlock({ team, ratio, hp, captain, top, total }: {
  team: Team;
  ratio: number;
  hp: number;
  captain: { nickname: string; avatar: string; coins: number } | null;
  top: Contributor[];
  total: number;
}) {
  return (
    <div className={`team-block ${team}`}>
      <div className="flex items-center justify-between">
        <span className="team-label">{team.toUpperCase()}</span>
        <span className="hp-text">{Math.ceil(hp)}</span>
      </div>
      <div className="hp-bar">
        <div className={`hp-fill ${team} ${ratio < 0.25 ? "low" : ""}`} style={{ transform: `scaleX(${ratio})` }} />
      </div>
      {captain && (
        <div className="captain-chip" title="Team captain">
          {captain.avatar ? <img src={captain.avatar} alt="" /> : <span>👑</span>}
          <span>👑 {truncate(captain.nickname, 12)}</span>
        </div>
      )}
      <div className="mini-head">TOP 3 · POINTS</div>
      <ol className="mini-top">
        {top.length === 0 && <li className="opacity-50">— be the first —</li>}
        {top.map((c, i) => (
          <li key={i}>
            <span>{i + 1}. {truncate(c.nickname, 11)}</span>
            <b>{formatDamage(c.damage)}</b>
          </li>
        ))}
      </ol>
      <div className="team-total">TOTAL <b>{formatDamage(total)}</b></div>
    </div>
  );
}

function GiftCard({ gift, phase }: { gift: GiftStrikePayload; phase: "spin" | "reveal" }) {
  const [spinVal, setSpinVal] = useState(1);
  useEffect(() => {
    if (phase !== "spin") return;
    const vals = gift.nearMiss && gift.nearMissDecoys.length ? [...gift.bonusDropBuckets, ...gift.nearMissDecoys] : gift.bonusDropBuckets;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setSpinVal(vals[i % vals.length]);
    }, 80);
    return () => clearInterval(t);
  }, [phase, gift]);
  const mult = gift.totalMultiplier;
  const wheelLabel = gift.wheelType === "rose" ? "🌹 ROSE WHEEL" : gift.wheelType === "wand" ? "🪄 WAND WHEEL" : "🎡 GIFT WHEEL";
  return (
    <div className={`gift-card ${gift.team} ${phase === "reveal" ? "reveal" : ""} ${gift.isCrit ? "crit" : ""}`}>
      <div className="gift-head">
        {gift.user.avatar ? <img src={gift.user.avatar} alt="" /> : <div className="avatar-fallback">🎁</div>}
        <div className="min-w-0">
          <div className="gift-name">{truncate(gift.user.nickname, 18)}</div>
          <div className="gift-sub">sent {gift.giftName} · 💎 {gift.giftDiamondTotal} · team {gift.team.toUpperCase()}</div>
        </div>
      </div>
      <div className="gift-wheel">
        <div className="wheel-label">{wheelLabel}{gift.doubleBonus ? " · DOUBLE ROUND" : ""}</div>
        <div className={`wheel-value ${phase}`}>×{phase === "spin" ? spinVal : mult}</div>
        {phase === "reveal" && gift.nearMiss && <div className="near-miss">so close to ×100!</div>}
      </div>
      {phase === "reveal" && (
        <div className="gift-result">
          <span className={`dmg ${gift.isCrit ? "crit" : ""}`}>{gift.isCrit ? "💥 CRIT " : ""}−{formatDamage(gift.damage)}</span>
          <span className="to"> to {gift.targetTower.toUpperCase()} tower</span>
          <div className="mods">
            {gift.powerMult > 1 && <span>⚡ POWER ×2</span>}
            {gift.comboActive && <span>🔗 CHAIN ×1.2</span>}
            {gift.suddenDeath && <span>🔥 FINAL ×5</span>}
            {gift.multiplier2 > 1 && <span>🎡 2nd wheel ×{gift.multiplier2}</span>}
          </div>
        </div>
      )}
      <div className="gift-caption">Thank you! Your support has been recorded 💖</div>
    </div>
  );
}

function GameOverPanel({ data }: { data: GameOverData }) {
  const winner = data.winner;
  const title = winner === "draw" ? "DRAW!" : `${winner.toUpperCase()} TEAM WINS!`;
  const sub = data.reason === "destroyed"
    ? `${data.destroyedTower?.toUpperCase()} tower has fallen`
    : "Time is up — tower with more HP wins";
  return (
    <div className={`gameover ${winner}`}>
      <div className="go-title">{title}</div>
      <div className="go-sub">{sub}</div>
      {data.mvp && (
        <div className="go-mvp">
          {data.mvp.avatar ? <img src={data.mvp.avatar} alt="" /> : <div className="avatar-fallback">🏆</div>}
          <div>
            <div className="go-mvp-label">MATCH STAR</div>
            <div className="go-mvp-name">{truncate(data.mvp.nickname, 18)}</div>
          </div>
        </div>
      )}
      {data.bonusPoolAmount > 0 && <div className="go-bonus">⭐ Match bonus score: {data.bonusPoolAmount}</div>}
      <div className="go-next">Next match starts in a moment…</div>
    </div>
  );
}
