import {
  recordDamage,
  recordGift,
  recordMatch,
  topLeaderboard,
} from "./persistence";
import type {
  Attacker,
  Captain,
  Contributor,
  GameEvent,
  GameState,
  GameUser,
  GiftStrikePayload,
  PowerBoost,
  RawTikTokEvent,
  Snapshot,
  Team,
  TikTokStatus,
} from "./types";

// ---------- Tunables (same as the original server.js) ----------
export const DAMAGE_PER_DIAMOND = 1;
export const POWER_FILL_PER_LIKE = 0.08;
export const POWER_FILL_SMALL_GIFT = 4;
export const POWER_THRESHOLD = 100;
export const POWER_DURATION_MS = 60_000;
export const MATCH_DURATION_MS = 5 * 60_000;
export const POST_GAME_WAIT_MS = 15_000;
export const GIFT_MIN_INTERVAL_MS = 120;
export const LIKE_BATCH_MS = 40;
export const MAX_LIKES_PER_BATCH = 400;
export const GIFT_BATCH_MS = 500;
export const BONUS_POOL_RATE = 0.01;
export const CRIT_CHANCE = 0.05;
export const COMBO_CHAIN_THRESHOLD = 5;
export const COMBO_DAMAGE_BONUS = 1.2;
export const SUDDEN_DEATH_DAMAGE_MULT = 5;
export const VIP_SESSION_DIAMONDS = 4000;
export const VIP_FOLLOWER_MIN = 50_000;
export const AUTO_JOIN_SOLDIER_ENABLED = true;
export const KILL_FEED_MIN_DAMAGE = 1200;
export const KILL_FEED_MIN_MULT = 25;
export const WELCOME_COOLDOWN_MS = 90_000;
export const SPIKER_INTERVAL_MS = 45_000;
export const BONUS_DROP_BUCKETS = [1, 2, 5, 10, 50, 100];
export const TOWER_MAX_HP = 10_000;

type Listener = (ev: GameEvent) => void;

interface SpendEntry {
  userId: string;
  nickname: string;
  avatar: string;
  coins: number;
}
interface DamageEntry {
  userId: string;
  nickname: string;
  avatar: string;
  damage: number;
}

function freshState(): GameState {
  return {
    red: { hp: TOWER_MAX_HP, maxHp: TOWER_MAX_HP, captain: null },
    blue: { hp: TOWER_MAX_HP, maxHp: TOWER_MAX_HP, captain: null },
    running: true,
    winner: null,
    gameStartedAt: Date.now(),
  };
}

export class GameEngine {
  gameState: GameState = freshState();
  matchDurationMs = MATCH_DURATION_MS;
  bonusPool = 0;
  suddenDeath = false;
  lastGiftTeam: Team | null = null;
  comboCount = 0;
  powerBoost: PowerBoost = { progress: 0, activeUntil: 0 };
  doubleMultiplierUntil = 0;
  viewerCount = 0;
  tiktok: TikTokStatus = { ok: false, msg: "Not connected.", username: "", connecting: false };

  private userTeams = new Map<string, Team>();
  private teamSpend: Record<Team, Map<string, SpendEntry>> = { red: new Map(), blue: new Map() };
  private teamMatchDamage: Record<Team, Map<string, DamageEntry>> = { red: new Map(), blue: new Map() };
  private lastGiftAt = new Map<string, number>();
  private userLifetimeGifts = new Map<string, number>();
  private lastWelcomeAt = new Map<string, number>();
  private lastHitOnTower: Record<Team, Attacker | null> = { red: null, blue: null };
  private lastLikeCount = 0;
  private pendingLikes = 0;
  private likeBatchTimer: NodeJS.Timeout | null = null;
  private giftBatchQueue: RawTikTokEvent[] = [];
  private giftBatchTimer: NodeJS.Timeout | null = null;
  private postGameTimer: NodeJS.Timeout | null = null;
  private spikerTimer: NodeJS.Timeout | null = null;
  private clockTimer: NodeJS.Timeout | null = null;
  private matchGiftCount = 0;
  private leaderboardCache: Snapshot["leaderboardTop"] = [];
  private listeners = new Set<Listener>();
  private recentEvents: GameEvent[] = [];

  constructor() {
    this.spikerTimer = setInterval(() => this.spikerTick(), SPIKER_INTERVAL_MS);
    this.spikerTimer.unref?.();
    this.clockTimer = setInterval(() => this.clockTick(), 1000);
    this.clockTimer.unref?.();
    void this.refreshLeaderboard();
  }

  // ---------- Pub/Sub ----------
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  emit(ev: GameEvent): void {
    this.recentEvents.push(ev);
    if (this.recentEvents.length > 50) this.recentEvents.shift();
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {
        /* ignore broken listener */
      }
    }
  }

  // ---------- Snapshot helpers ----------
  private teamTop(): { red: Contributor[]; blue: Contributor[] } {
    return {
      red: this.topTeamContributors("red", 3),
      blue: this.topTeamContributors("blue", 3),
    };
  }

  private teamTotals(): { red: number; blue: number } {
    return {
      red: this.sumTeamMatchDamage("red"),
      blue: this.sumTeamMatchDamage("blue"),
    };
  }

  snapshot(): Snapshot {
    this.ensureTimeoutChecked();
    return {
      gameState: structuredClone(this.gameState),
      powerBoost: { ...this.powerBoost },
      doubleMultiplierUntil: this.doubleMultiplierUntil,
      matchDurationMs: this.matchDurationMs,
      gameStartedAt: this.gameState.gameStartedAt,
      bonusPool: this.bonusPool,
      suddenDeath: this.suddenDeath,
      comboCount: this.comboCount,
      leaderboardTop: this.leaderboardCache,
      teamTop: this.teamTop(),
      teamTotals: this.teamTotals(),
      viewerCount: this.viewerCount,
      tiktok: { ...this.tiktok },
    };
  }

  async refreshLeaderboard(): Promise<void> {
    try {
      this.leaderboardCache = await topLeaderboard(5);
    } catch {
      /* DB not ready - keep cache */
    }
  }

  broadcastState(): void {
    this.emit({
      type: "state",
      data: {
        gameState: structuredClone(this.gameState),
        powerBoost: { ...this.powerBoost },
        bonusPool: this.bonusPool,
        suddenDeath: this.suddenDeath,
        comboCount: this.comboCount,
        matchDurationMs: this.matchDurationMs,
        teamTop: this.teamTop(),
        teamTotals: this.teamTotals(),
      },
    });
  }

  setTikTokStatus(s: Partial<TikTokStatus>): void {
    this.tiktok = { ...this.tiktok, ...s };
    this.emit({ type: "tiktokStatus", data: { ...this.tiktok } });
  }

  // ---------- Team / contributor bookkeeping ----------
  private addMatchDamage(team: Team, uid: string, damage: number, nickname: string, avatar: string) {
    if (!uid || damage <= 0) return;
    const m = this.teamMatchDamage[team];
    const cur = m.get(uid) ?? { userId: uid, nickname, avatar, damage: 0 };
    cur.damage += damage;
    cur.nickname = nickname || cur.nickname;
    cur.avatar = avatar || cur.avatar;
    m.set(uid, cur);
  }

  private sumTeamMatchDamage(team: Team): number {
    let s = 0;
    for (const v of this.teamMatchDamage[team].values()) s += v.damage || 0;
    return Math.floor(s);
  }

  private topTeamContributors(team: Team, n: number): Contributor[] {
    return [...this.teamMatchDamage[team].values()]
      .sort((a, b) => b.damage - a.damage)
      .slice(0, n)
      .map((u) => ({
        nickname: u.nickname || "Player",
        avatar: u.avatar || "",
        damage: Math.floor(u.damage || 0),
      }));
  }

  private hashTeam(uid: string): Team {
    let h = 0;
    const s = String(uid || "anon");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 2 === 0 ? "red" : "blue";
  }

  getTeam(uid: string): Team {
    let t = this.userTeams.get(uid);
    if (!t) {
      t = this.hashTeam(uid);
      this.userTeams.set(uid, t);
    }
    return t;
  }

  private assignTeamFromChat(uid: string, text: string): Team | null {
    const t = String(text || "").trim().toLowerCase();
    if (t === "1" || t === "red" || t === "kırmızı" || t === "vermelho") {
      this.userTeams.set(uid, "red");
      return "red";
    }
    if (t === "2" || t === "blue" || t === "mavi" || t === "azul") {
      this.userTeams.set(uid, "blue");
      return "blue";
    }
    return null;
  }

  private pickCaptain(team: Team): Captain | null {
    let best: SpendEntry | null = null;
    for (const v of this.teamSpend[team].values()) {
      if (!best || v.coins > best.coins) best = { ...v };
    }
    return best;
  }

  private updateCaptains() {
    this.gameState.red.captain = this.pickCaptain("red");
    this.gameState.blue.captain = this.pickCaptain("blue");
  }

  private addTeamSpend(team: Team, uid: string, coins: number, nickname: string, avatar: string) {
    const m = this.teamSpend[team];
    const cur = m.get(uid) ?? { userId: uid, nickname, avatar, coins: 0 };
    cur.coins += coins;
    cur.nickname = nickname || cur.nickname;
    cur.avatar = avatar || cur.avatar;
    m.set(uid, cur);
    this.updateCaptains();
  }

  // ---------- Multiplier wheel ----------
  private weightedMultiplier(giftDiamondTotal: number): number {
    const w = Math.min(1, giftDiamondTotal / 500);
    const roll = Math.random();
    const biasHigh = 0.15 + w * 0.55;
    if (roll < 0.1 - w * 0.05) return 1;
    if (roll < 0.28) return 2;
    if (roll < 0.48 - w * 0.08) return 5;
    if (roll < 0.72 - w * 0.1) return 10;
    if (roll < 0.92 - w * 0.05 + biasHigh * 0.02) return 50;
    return 100;
  }

  private rollSpin(giftDiamondTotal: number) {
    const near = giftDiamondTotal >= 40 && Math.random() < 0.38;
    let finalM = this.weightedMultiplier(giftDiamondTotal);
    if (near) {
      const decoys = [100, 100, 50];
      if (finalM >= 50) finalM = [5, 10][Math.floor(Math.random() * 2)];
      return { finalMultiplier: finalM, nearMiss: true, decoys };
    }
    return { finalMultiplier: finalM, nearMiss: false, decoys: [] as number[] };
  }

  private rollSpinTiered(giftDiamondTotal: number) {
    const spin1 = this.rollSpin(giftDiamondTotal);
    let m1 = spin1.finalMultiplier;
    let wheelType: GiftStrikePayload["wheelType"] = "standard";
    if (giftDiamondTotal <= 1) wheelType = "rose";
    else if (giftDiamondTotal >= 100) {
      wheelType = "wand";
      m1 = Math.max(5, m1);
    }
    return { ...spin1, finalMultiplier: m1, wheelType };
  }

  private nowPowerMult(): number {
    return Date.now() < this.powerBoost.activeUntil ? 2 : 1;
  }

  private isDoubleMultiplierRound(): boolean {
    const t = Date.now();
    if (t < this.doubleMultiplierUntil) return true;
    const elapsed = t - this.gameState.gameStartedAt;
    return elapsed >= this.matchDurationMs - 60_000;
  }

  private applyDamage(target: Team, damage: number, attacker: Attacker) {
    const prev = this.gameState[target].hp;
    const next = Math.max(0, prev - damage);
    this.gameState[target].hp = next;
    this.lastHitOnTower[target] = attacker;
    return { prev, next, destroyed: prev > 0 && next <= 0 };
  }

  // ---------- Likes / power ----------
  addLikes(n: number): void {
    this.pendingLikes += Math.max(1, Math.floor(n));
    if (!this.likeBatchTimer) {
      this.likeBatchTimer = setTimeout(() => {
        this.likeBatchTimer = null;
        this.flushLikes();
      }, LIKE_BATCH_MS);
    }
  }

  private flushLikes() {
    if (this.pendingLikes <= 0) return;
    const n = Math.min(this.pendingLikes, MAX_LIKES_PER_BATCH);
    this.pendingLikes -= n;
    this.powerBoost.progress = Math.min(POWER_THRESHOLD, this.powerBoost.progress + n * POWER_FILL_PER_LIKE);
    this.emit({ type: "likeBurst", data: { count: n, powerProgress: this.powerBoost.progress } });
    this.maybeStartPowerMode();
    if (this.pendingLikes > 0) {
      this.likeBatchTimer = setTimeout(() => {
        this.likeBatchTimer = null;
        this.flushLikes();
      }, LIKE_BATCH_MS);
    }
  }

  private maybeStartPowerMode() {
    if (this.powerBoost.progress < POWER_THRESHOLD) return;
    if (Date.now() < this.powerBoost.activeUntil) return;
    this.powerBoost.progress = 0;
    this.powerBoost.activeUntil = Date.now() + POWER_DURATION_MS;
    this.emit({ type: "powerMode", data: { active: true, until: this.powerBoost.activeUntil, powerProgress: 0 } });
  }

  forcePowerMode(durationMs?: number): number {
    const d = durationMs || POWER_DURATION_MS;
    this.powerBoost.progress = 0;
    this.powerBoost.activeUntil = Date.now() + d;
    this.emit({ type: "powerMode", data: { active: true, until: this.powerBoost.activeUntil, powerProgress: 0 } });
    return this.powerBoost.activeUntil;
  }

  // ---------- Match lifecycle ----------
  private scheduleGameReset() {
    if (this.postGameTimer) clearTimeout(this.postGameTimer);
    this.postGameTimer = setTimeout(() => this.resetMatch(), POST_GAME_WAIT_MS);
    this.postGameTimer.unref?.();
  }

  resetMatch(): void {
    if (this.postGameTimer) {
      clearTimeout(this.postGameTimer);
      this.postGameTimer = null;
    }
    this.suddenDeath = false;
    this.lastGiftTeam = null;
    this.comboCount = 0;
    this.gameState = freshState();
    this.lastHitOnTower = { red: null, blue: null };
    this.teamSpend.red.clear();
    this.teamSpend.blue.clear();
    this.teamMatchDamage.red.clear();
    this.teamMatchDamage.blue.clear();
    this.powerBoost = { progress: 0, activeUntil: 0 };
    this.doubleMultiplierUntil = 0;
    this.matchGiftCount = 0;
    this.emit({ type: "gameReset", data: this.snapshot() });
  }

  private endMatch(opts: {
    winner: Team | "draw";
    reason: "destroyed" | "timeout";
    destroyedTower: Team | null;
  }) {
    const mvp = opts.destroyedTower
      ? this.lastHitOnTower[opts.destroyedTower]
      : (() => {
          // Timeout: MVP is the top contributor of the winning team (or overall).
          const candidates: Array<DamageEntry & { team: Team }> = [];
          for (const team of ["red", "blue"] as Team[]) {
            if (opts.winner !== "draw" && opts.winner !== team) continue;
            for (const v of this.teamMatchDamage[team].values()) candidates.push({ ...v, team });
          }
          candidates.sort((a, b) => b.damage - a.damage);
          const c = candidates[0];
          if (!c) return null;
          const atk: Attacker = {
            userId: c.userId,
            uniqueId: c.userId,
            nickname: c.nickname,
            avatar: c.avatar,
            team: c.team,
            targetTower: c.team === "red" ? "blue" : "red",
            multiplier: 1,
          };
          return atk;
        })();

    this.gameState.running = false;
    this.gameState.winner = opts.winner;
    const jpAmount = Math.floor(this.bonusPool);
    this.bonusPool = 0;
    const totals = this.teamTotals();

    this.emit({ type: "bonusPoolWin", data: { amount: jpAmount, mvp, winTeam: opts.winner } });
    this.emit({
      type: "gameOver",
      data: {
        winner: opts.winner,
        destroyedTower: opts.destroyedTower,
        reason: opts.reason,
        mvp,
        gameState: structuredClone(this.gameState),
        bonusPoolAmount: jpAmount,
      },
    });

    void recordMatch({
      startedAt: this.gameState.gameStartedAt,
      winner: opts.winner,
      endReason: opts.reason,
      destroyedTower: opts.destroyedTower,
      redHp: this.gameState.red.hp,
      blueHp: this.gameState.blue.hp,
      redDamage: totals.red,
      blueDamage: totals.blue,
      mvp: mvp ? { uid: mvp.uniqueId || mvp.userId, nickname: mvp.nickname, avatar: mvp.avatar } : null,
      bonusPool: jpAmount,
      suddenDeath: this.suddenDeath,
      giftCount: this.matchGiftCount,
    }).catch(() => undefined);

    void this.refreshLeaderboard();
    this.scheduleGameReset();
  }

  /**
   * Finalizes the match when the timer expires. The 1s interval calls this on a
   * persistent server; on serverless (Vercel) intervals don't run reliably, so
   * this is also invoked lazily from snapshot()/processGift().
   */
  ensureTimeoutChecked(): void {
    if (!this.gameState.running) return;
    const elapsed = Date.now() - this.gameState.gameStartedAt;
    if (elapsed < this.matchDurationMs) return;
    const r = this.gameState.red.hp;
    const b = this.gameState.blue.hp;
    const winner: Team | "draw" = r === b ? "draw" : r > b ? "red" : "blue";
    this.endMatch({ winner, reason: "timeout", destroyedTower: null });
  }

  private clockTick() {
    this.ensureTimeoutChecked();
  }

  extendMatch(ms: number): number {
    this.matchDurationMs = Math.max(60_000, this.matchDurationMs + ms);
    this.emit({ type: "matchConfig", data: { matchDurationMs: this.matchDurationMs } });
    return this.matchDurationMs;
  }

  activateSuddenDeath(): void {
    this.suddenDeath = true;
    this.emit({ type: "suddenDeath", data: { active: true, damageMult: SUDDEN_DEATH_DAMAGE_MULT } });
  }

  spawnBot(team: Team, name: string): void {
    const nickname = String(name || "Support Bot").slice(0, 24);
    this.emit({
      type: "soldier",
      data: {
        team,
        user: { nickname, uniqueId: "bot_" + Date.now(), userId: "", avatar: "", team },
        fromGift: false,
        bot: true,
      },
    });
  }

  // ---------- Raw event extraction ----------
  static extractUser(g: RawTikTokEvent): GameUser {
    const u = (g.user ?? g) as Record<string, unknown>;
    const pic = u.profilePicture as { url?: string | string[] } | undefined;
    const picUrl = Array.isArray(pic?.url) ? pic?.url[0] : pic?.url;
    return {
      userId: String(u.userId ?? u.user_id ?? u.uniqueId ?? ""),
      uniqueId: String(u.uniqueId ?? u.unique_id ?? ""),
      nickname: String(u.nickname ?? u.NickName ?? "Player"),
      avatar: String(u.profilePictureUrl ?? picUrl ?? ""),
    };
  }

  static extractFollowerCount(raw: RawTikTokEvent): number | null {
    const u = (raw.user ?? raw) as Record<string, unknown>;
    const n = u.followerCount ?? u.follower_count ?? raw.followerCount ?? raw.viewerCount ?? raw.memberCount;
    if (n == null) return null;
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }

  static extractGiftMoney(g: RawTikTokEvent): number {
    if (g._mergedDiamonds != null) return Math.max(1, Math.floor(Number(g._mergedDiamonds)));
    const repeat = Math.max(1, parseInt(String(g.repeatCount ?? "1"), 10) || 1);
    let per = 1;
    const ext = g.extendedGiftInfo as Record<string, unknown> | undefined;
    const det = g.giftDetails as Record<string, unknown> | undefined;
    const gift = g.gift as Record<string, unknown> | undefined;
    if (ext && ext.diamond_count != null) per = Number(ext.diamond_count) || 1;
    else if (det && det.diamondCount != null) per = Number(det.diamondCount) || 1;
    else if (g.diamondCount != null) per = Number(g.diamondCount) || 1;
    else if (gift && gift.diamond_count != null) per = Number(gift.diamond_count) || 1;
    else if (gift && gift.diamondCount != null) per = Number(gift.diamondCount) || 1;
    return Math.max(1, Math.floor(per * repeat));
  }

  static extractGiftName(g: RawTikTokEvent): string {
    const gift = g.gift as Record<string, unknown> | undefined;
    const ext = g.extendedGiftInfo as Record<string, unknown> | undefined;
    return String(g.giftName ?? gift?.name ?? ext?.name ?? "Gift");
  }

  // ---------- Gifts ----------
  queueGiftForBatch(raw: RawTikTokEvent): void {
    if (!this.gameState.running) return;
    if (raw.repeatEnd === false) return;
    this.giftBatchQueue.push(raw);
    if (!this.giftBatchTimer) {
      this.giftBatchTimer = setTimeout(() => {
        this.giftBatchTimer = null;
        this.flushGiftBatch();
      }, GIFT_BATCH_MS);
    }
  }

  private flushGiftBatch() {
    if (this.giftBatchQueue.length === 0) return;
    const batch = this.giftBatchQueue.splice(0, this.giftBatchQueue.length);
    const byUser = new Map<string, { last: RawTikTokEvent; sum: number }>();
    for (const raw of batch) {
      const user = GameEngine.extractUser(raw);
      const uid = user.uniqueId || user.userId;
      if (!uid) continue;
      const diamonds = GameEngine.extractGiftMoney(raw);
      const e = byUser.get(uid) ?? { last: raw, sum: 0 };
      e.sum += diamonds;
      e.last = raw;
      byUser.set(uid, e);
    }
    for (const v of byUser.values()) {
      this.processGift({ ...v.last, _mergedDiamonds: v.sum });
    }
  }

  processGift(raw: RawTikTokEvent): GiftStrikePayload | null {
    if (!this.gameState.running) return null;
    const user = GameEngine.extractUser(raw);
    const uid = user.uniqueId || user.userId;
    if (!uid) return null;

    const now = Date.now();
    const last = this.lastGiftAt.get(uid) ?? 0;
    if (now - last < GIFT_MIN_INTERVAL_MS) return null;
    this.lastGiftAt.set(uid, now);

    const giftDiamondTotal = GameEngine.extractGiftMoney(raw);
    const giftName = GameEngine.extractGiftName(raw);
    const team = this.getTeam(uid);
    const targetTower: Team = team === "red" ? "blue" : "red";

    if (this.lastGiftTeam === team) this.comboCount += 1;
    else {
      this.comboCount = 1;
      this.lastGiftTeam = team;
    }
    const comboActive = this.comboCount >= COMBO_CHAIN_THRESHOLD;
    const comboMult = comboActive ? COMBO_DAMAGE_BONUS : 1;

    this.userLifetimeGifts.set(uid, (this.userLifetimeGifts.get(uid) ?? 0) + giftDiamondTotal);
    this.bonusPool += Math.floor(giftDiamondTotal * BONUS_POOL_RATE);

    const spin1 = this.rollSpinTiered(giftDiamondTotal);
    const m1 = spin1.finalMultiplier;
    let m2 = 1;
    const doubleBonus = this.isDoubleMultiplierRound();
    if (doubleBonus) m2 = this.weightedMultiplier(giftDiamondTotal * 0.85);

    const powerMult = this.nowPowerMult();
    const sdMult = this.suddenDeath ? SUDDEN_DEATH_DAMAGE_MULT : 1;
    const base = giftDiamondTotal * DAMAGE_PER_DIAMOND;
    let damage = Math.floor(base * m1 * m2 * powerMult * sdMult * comboMult);
    const isCrit = Math.random() < CRIT_CHANCE;
    if (isCrit) damage = Math.floor(damage * 2);
    if (damage < 1) damage = 1;

    const attacker: Attacker = { ...user, team, targetTower, multiplier: m1 * m2 };
    const { destroyed } = this.applyDamage(targetTower, damage, attacker);

    this.addTeamSpend(team, uid, giftDiamondTotal * (m1 * m2), user.nickname, user.avatar);
    this.addMatchDamage(team, uid, damage, user.nickname, user.avatar);
    this.matchGiftCount += 1;

    void recordDamage(uid, user.nickname, user.avatar, damage)
      .then(() => this.refreshLeaderboard())
      .catch(() => undefined);
    void recordGift({
      uid,
      nickname: user.nickname,
      avatar: user.avatar,
      team,
      targetTower,
      diamonds: giftDiamondTotal,
      multiplier: m1 * m2,
      damage,
      isCrit,
      simulated: raw._simulated === true,
    }).catch(() => undefined);

    this.powerBoost.progress = Math.min(
      POWER_THRESHOLD,
      this.powerBoost.progress + Math.min(25, giftDiamondTotal * 0.05 + POWER_FILL_SMALL_GIFT),
    );
    this.maybeStartPowerMode();

    const totalMult = m1 * m2;
    const targetLabel = targetTower === "red" ? "RED" : "BLUE";
    const showKillFeed =
      damage >= KILL_FEED_MIN_DAMAGE || totalMult >= KILL_FEED_MIN_MULT || (isCrit && damage >= 500);

    const payload: GiftStrikePayload = {
      user,
      team,
      targetTower,
      giftDiamondTotal,
      giftName,
      multiplier1: m1,
      multiplier2: m2,
      totalMultiplier: totalMult,
      nearMiss: spin1.nearMiss,
      nearMissDecoys: spin1.decoys,
      bonusDropBuckets: BONUS_DROP_BUCKETS,
      damage,
      powerModeActive: Date.now() < this.powerBoost.activeUntil,
      doubleBonus,
      powerMult,
      suddenDeath: this.suddenDeath,
      suddenDeathMult: sdMult,
      comboCount: this.comboCount,
      comboActive,
      comboMult,
      isCrit,
      wheelType: spin1.wheelType,
      bonusPool: this.bonusPool,
      gameState: structuredClone(this.gameState),
      caption: `${user.nickname} - thanks, your support has been recorded`,
      teamTop: this.teamTop(),
      teamTotals: this.teamTotals(),
    };
    if (showKillFeed) {
      payload.killFeed = {
        nickname: user.nickname || "Player",
        targetTower,
        targetLabel,
        damage,
        mult: totalMult,
        isCrit,
      };
    }
    this.emit({ type: "giftStrike", data: payload });
    this.emit({ type: "soldier", data: { team, user: { ...user, team }, fromGift: true } });
    if (totalMult >= 50) {
      this.emit({
        type: "spiker",
        data: { lines: [`${user.nickname} - thank you, that was strong support.`], shake: true },
      });
    }
    this.broadcastState();

    if (destroyed) {
      const winTeam: Team = targetTower === "blue" ? "red" : "blue";
      this.endMatch({ winner: winTeam, reason: "destroyed", destroyedTower: targetTower });
    }
    return payload;
  }

  // ---------- Joins / chat / viewers ----------
  handleMemberJoin(raw: RawTikTokEvent): void {
    const user = GameEngine.extractUser(raw);
    const uid = user.uniqueId || user.userId;
    if (!uid) return;
    const now = Date.now();
    const prev = this.lastWelcomeAt.get(uid) ?? 0;
    if (now - prev < WELCOME_COOLDOWN_MS) return;
    this.lastWelcomeAt.set(uid, now);

    const followers = GameEngine.extractFollowerCount(raw);
    const sessionD = this.userLifetimeGifts.get(uid) ?? 0;
    const isVip = sessionD >= VIP_SESSION_DIAMONDS || (followers != null && followers >= VIP_FOLLOWER_MIN);
    const team = this.getTeam(uid);

    this.emit({ type: "viewerJoin", data: { user, team, vip: isVip, followers, sessionDiamonds: sessionD } });
    this.emit({ type: "teamPick", data: { user, team } });
    if (AUTO_JOIN_SOLDIER_ENABLED) {
      this.emit({ type: "soldier", data: { team, user: { ...user, team }, autoJoin: true } });
    }
  }

  handleRoomUser(raw: RawTikTokEvent): void {
    const n = raw.viewerCount ?? raw.totalUser ?? raw.total;
    if (n != null && Number.isFinite(Number(n))) {
      this.viewerCount = Number(n);
      this.emit({ type: "viewerCount", data: { count: this.viewerCount } });
    }
  }

  setViewerCount(n: number): void {
    this.viewerCount = Math.max(0, Math.floor(n));
    this.emit({ type: "viewerCount", data: { count: this.viewerCount } });
  }

  handleChat(raw: RawTikTokEvent): void {
    const user = GameEngine.extractUser(raw);
    const uid = user.uniqueId || user.userId;
    if (!uid) return;
    const comment = String(raw.comment ?? raw.text ?? "").trim();
    const picked = this.assignTeamFromChat(uid, comment);
    const team = this.getTeam(uid);
    this.emit({ type: "chat", data: { user, team, comment: comment.slice(0, 120) } });
    if (picked) {
      this.emit({ type: "teamPick", data: { user, team: picked } });
      this.emit({ type: "soldier", data: { team: picked, user: { ...user, team: picked } } });
    }
  }

  handleLike(raw: RawTikTokEvent): void {
    const total = raw.totalLikeCount != null ? Number(raw.totalLikeCount) : null;
    if (total == null || !Number.isFinite(total)) {
      const c = Number(raw.likeCount ?? 1);
      this.addLikes(Number.isFinite(c) && c > 0 ? c : 1);
    } else {
      const delta = Math.max(0, total - this.lastLikeCount);
      this.lastLikeCount = total;
      this.addLikes(Math.max(1, delta));
    }
  }

  // ---------- Commentator ----------
  spikerTick(): void {
    if (this.listeners.size === 0) return;
    const r = this.gameState.red.hp / this.gameState.red.maxHp;
    const b = this.gameState.blue.hp / this.gameState.blue.maxHp;
    const msgs: string[] = [];
    if (r < 0.5 && b > r) msgs.push("Red team is behind, blue is ahead.");
    else if (b < 0.5 && r > b) msgs.push("Blue team is behind, red is ahead.");
    if (b < 0.1) msgs.push("Blue tower is weak - send team support.");
    if (r < 0.1) msgs.push("Red tower is weak - send team support.");
    if (msgs.length === 0) {
      const pool = [
        "Red and blue interactive show - join your team.",
        "When the chain fills, your team gets extra power.",
        "Power bar is filling - support with likes.",
        "Type 1 for RED or 2 for BLUE in chat.",
      ];
      msgs.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    this.emit({ type: "spiker", data: { lines: msgs, shake: true } });
  }
}

// ---------- Singleton (survives HMR in dev, single process in prod) ----------
const g = globalThis as typeof globalThis & { __towerBattleEngine?: GameEngine };

export function getEngine(): GameEngine {
  if (!g.__towerBattleEngine) {
    g.__towerBattleEngine = new GameEngine();
  }
  return g.__towerBattleEngine;
}
