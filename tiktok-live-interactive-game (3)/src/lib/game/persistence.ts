import { db, requireDatabase } from "@/db";
import { giftEvents, leaderboardEntries, matches } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { LeaderboardTop, Team } from "./types";

export function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function recordDamage(
  uid: string,
  nickname: string,
  avatar: string,
  dmg: number,
): Promise<void> {
  if (!uid || dmg <= 0) return;
  requireDatabase();
  await db
    .insert(leaderboardEntries)
    .values({
      dayKey: dayKey(),
      uid,
      nickname: nickname || "Player",
      avatar: avatar || "",
      damage: Math.floor(dmg),
    })
    .onConflictDoUpdate({
      target: [leaderboardEntries.dayKey, leaderboardEntries.uid],
      set: {
        damage: sql`${leaderboardEntries.damage} + ${Math.floor(dmg)}`,
        nickname: nickname || sql`${leaderboardEntries.nickname}`,
        avatar: avatar || sql`${leaderboardEntries.avatar}`,
        updatedAt: new Date(),
      },
    });
}

export async function topLeaderboard(n: number): Promise<LeaderboardTop[]> {
  requireDatabase();
  const rows = await db
    .select({
      uid: leaderboardEntries.uid,
      nickname: leaderboardEntries.nickname,
      avatar: leaderboardEntries.avatar,
      damage: leaderboardEntries.damage,
    })
    .from(leaderboardEntries)
    .where(eq(leaderboardEntries.dayKey, dayKey()))
    .orderBy(desc(leaderboardEntries.damage))
    .limit(n);
  return rows;
}

export async function topLeaderboardForDay(day: string, n: number): Promise<LeaderboardTop[]> {
  requireDatabase();
  return db
    .select({
      uid: leaderboardEntries.uid,
      nickname: leaderboardEntries.nickname,
      avatar: leaderboardEntries.avatar,
      damage: leaderboardEntries.damage,
    })
    .from(leaderboardEntries)
    .where(and(eq(leaderboardEntries.dayKey, day)))
    .orderBy(desc(leaderboardEntries.damage))
    .limit(n);
}

export interface MatchRecordInput {
  startedAt: number;
  winner: Team | "draw";
  endReason: "destroyed" | "timeout";
  destroyedTower: Team | null;
  redHp: number;
  blueHp: number;
  redDamage: number;
  blueDamage: number;
  mvp: { uid: string; nickname: string; avatar: string } | null;
  bonusPool: number;
  suddenDeath: boolean;
  giftCount: number;
}

export async function recordMatch(m: MatchRecordInput): Promise<void> {
  requireDatabase();
  await db.insert(matches).values({
    startedAt: new Date(m.startedAt),
    endedAt: new Date(),
    winner: m.winner,
    endReason: m.endReason,
    destroyedTower: m.destroyedTower,
    redHp: Math.floor(m.redHp),
    blueHp: Math.floor(m.blueHp),
    redDamage: Math.floor(m.redDamage),
    blueDamage: Math.floor(m.blueDamage),
    mvpUid: m.mvp?.uid ?? null,
    mvpNickname: m.mvp?.nickname ?? null,
    mvpAvatar: m.mvp?.avatar ?? null,
    bonusPool: Math.floor(m.bonusPool),
    suddenDeath: m.suddenDeath,
    giftCount: m.giftCount,
  });
}

export interface GiftLogInput {
  uid: string;
  nickname: string;
  avatar: string;
  team: Team;
  targetTower: Team;
  diamonds: number;
  multiplier: number;
  damage: number;
  isCrit: boolean;
  simulated: boolean;
}

export async function recordGift(g: GiftLogInput): Promise<void> {
  requireDatabase();
  await db.insert(giftEvents).values({
    uid: g.uid,
    nickname: g.nickname || "Player",
    avatar: g.avatar || "",
    team: g.team,
    targetTower: g.targetTower,
    diamonds: Math.floor(g.diamonds),
    multiplier: Math.floor(g.multiplier),
    damage: Math.floor(g.damage),
    isCrit: g.isCrit,
    simulated: g.simulated,
  });
}

export async function recentMatches(n: number) {
  requireDatabase();
  return db.select().from(matches).orderBy(desc(matches.endedAt)).limit(n);
}

export async function recentGifts(n: number) {
  requireDatabase();
  return db.select().from(giftEvents).orderBy(desc(giftEvents.createdAt)).limit(n);
}

export async function overallStats() {
  requireDatabase();
  const [m] = await db
    .select({
      total: sql<number>`count(*)::int`,
      redWins: sql<number>`sum(case when ${matches.winner} = 'red' then 1 else 0 end)::int`,
      blueWins: sql<number>`sum(case when ${matches.winner} = 'blue' then 1 else 0 end)::int`,
      draws: sql<number>`sum(case when ${matches.winner} = 'draw' then 1 else 0 end)::int`,
    })
    .from(matches);
  const [g] = await db
    .select({
      gifts: sql<number>`count(*)::int`,
      diamonds: sql<number>`coalesce(sum(${giftEvents.diamonds}),0)::int`,
      damage: sql<number>`coalesce(sum(${giftEvents.damage}),0)::bigint`,
    })
    .from(giftEvents);
  return {
    matches: m?.total ?? 0,
    redWins: m?.redWins ?? 0,
    blueWins: m?.blueWins ?? 0,
    draws: m?.draws ?? 0,
    gifts: g?.gifts ?? 0,
    diamonds: g?.diamonds ?? 0,
    damage: Number(g?.damage ?? 0),
  };
}
