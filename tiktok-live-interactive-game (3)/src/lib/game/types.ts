export type Team = "red" | "blue";

export interface GameUser {
  userId: string;
  uniqueId: string;
  nickname: string;
  avatar: string;
}

export interface Captain {
  userId: string;
  nickname: string;
  avatar: string;
  coins: number;
}

export interface TowerState {
  hp: number;
  maxHp: number;
  captain: Captain | null;
}

export interface GameState {
  red: TowerState;
  blue: TowerState;
  running: boolean;
  winner: Team | "draw" | null;
  gameStartedAt: number;
}

export interface PowerBoost {
  progress: number;
  activeUntil: number;
}

export interface Contributor {
  nickname: string;
  avatar: string;
  damage: number;
}

export interface LeaderboardTop {
  uid: string;
  nickname: string;
  avatar: string;
  damage: number;
}

export interface Attacker extends GameUser {
  team: Team;
  targetTower: Team;
  multiplier: number;
}

export interface Snapshot {
  gameState: GameState;
  powerBoost: PowerBoost;
  doubleMultiplierUntil: number;
  matchDurationMs: number;
  gameStartedAt: number;
  bonusPool: number;
  suddenDeath: boolean;
  comboCount: number;
  leaderboardTop: LeaderboardTop[];
  teamTop: { red: Contributor[]; blue: Contributor[] };
  teamTotals: { red: number; blue: number };
  viewerCount: number;
  tiktok: TikTokStatus;
}

export interface TikTokStatus {
  ok: boolean;
  msg: string;
  username: string;
  connecting: boolean;
}

export interface GiftStrikePayload {
  user: GameUser;
  team: Team;
  targetTower: Team;
  giftDiamondTotal: number;
  giftName: string;
  multiplier1: number;
  multiplier2: number;
  totalMultiplier: number;
  nearMiss: boolean;
  nearMissDecoys: number[];
  bonusDropBuckets: number[];
  damage: number;
  powerModeActive: boolean;
  doubleBonus: boolean;
  powerMult: number;
  suddenDeath: boolean;
  suddenDeathMult: number;
  comboCount: number;
  comboActive: boolean;
  comboMult: number;
  isCrit: boolean;
  wheelType: "rose" | "standard" | "wand";
  bonusPool: number;
  gameState: GameState;
  caption: string;
  teamTop: { red: Contributor[]; blue: Contributor[] };
  teamTotals: { red: number; blue: number };
  killFeed?: {
    nickname: string;
    targetTower: Team;
    targetLabel: string;
    damage: number;
    mult: number;
    isCrit: boolean;
  };
}

export type GameEvent =
  | { type: "init"; data: Snapshot }
  | {
      type: "state";
      data: Pick<
        Snapshot,
        | "gameState"
        | "powerBoost"
        | "bonusPool"
        | "suddenDeath"
        | "comboCount"
        | "matchDurationMs"
        | "teamTop"
        | "teamTotals"
      >;
    }
  | { type: "gameReset"; data: Snapshot }
  | {
      type: "gameOver";
      data: {
        winner: Team | "draw";
        destroyedTower: Team | null;
        reason: "destroyed" | "timeout";
        mvp: Attacker | null;
        gameState: GameState;
        bonusPoolAmount: number;
      };
    }
  | { type: "giftStrike"; data: GiftStrikePayload }
  | { type: "likeBurst"; data: { count: number; powerProgress: number } }
  | { type: "powerMode"; data: { active: boolean; until: number; powerProgress: number } }
  | {
      type: "viewerJoin";
      data: { user: GameUser; team: Team; vip: boolean; followers: number | null; sessionDiamonds: number };
    }
  | { type: "viewerCount"; data: { count: number } }
  | { type: "teamPick"; data: { user: GameUser; team: Team } }
  | { type: "spiker"; data: { lines: string[]; shake: boolean } }
  | { type: "bonusPoolWin"; data: { amount: number; mvp: Attacker | null; winTeam: Team | "draw" } }
  | { type: "suddenDeath"; data: { active: boolean; damageMult: number } }
  | { type: "matchConfig"; data: { matchDurationMs: number } }
  | {
      type: "soldier";
      data: { team: Team; user: GameUser & { team: Team }; fromGift?: boolean; autoJoin?: boolean; bot?: boolean };
    }
  | { type: "chat"; data: { user: GameUser; team: Team; comment: string } }
  | { type: "tiktokStatus"; data: TikTokStatus };

export type GameEventType = GameEvent["type"];

/** Loose shape for raw TikTok events (library payloads vary between versions). */
export type RawTikTokEvent = Record<string, unknown> & {
  user?: Record<string, unknown>;
};
