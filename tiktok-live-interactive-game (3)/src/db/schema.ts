import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Daily damage leaderboard. One row per (day, viewer).
 * Replaces the original `data/leaderboard.json` file store.
 */
export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: serial("id").primaryKey(),
    dayKey: varchar("day_key", { length: 10 }).notNull(),
    uid: varchar("uid", { length: 128 }).notNull(),
    nickname: varchar("nickname", { length: 120 }).notNull().default("Player"),
    avatar: text("avatar").notNull().default(""),
    damage: integer("damage").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leaderboard_day_uid_idx").on(t.dayKey, t.uid),
    index("leaderboard_day_damage_idx").on(t.dayKey, t.damage),
  ],
);

/**
 * Completed matches (tower destroyed or timer expired).
 */
export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull().defaultNow(),
  winner: varchar("winner", { length: 8 }).notNull(), // red | blue | draw
  endReason: varchar("end_reason", { length: 16 }).notNull(), // destroyed | timeout
  destroyedTower: varchar("destroyed_tower", { length: 8 }),
  redHp: integer("red_hp").notNull(),
  blueHp: integer("blue_hp").notNull(),
  redDamage: integer("red_damage").notNull().default(0),
  blueDamage: integer("blue_damage").notNull().default(0),
  mvpUid: varchar("mvp_uid", { length: 128 }),
  mvpNickname: varchar("mvp_nickname", { length: 120 }),
  mvpAvatar: text("mvp_avatar"),
  bonusPool: integer("bonus_pool").notNull().default(0),
  suddenDeath: boolean("sudden_death").notNull().default(false),
  giftCount: integer("gift_count").notNull().default(0),
});

/**
 * Every processed gift strike (useful for analytics and the history page).
 */
export const giftEvents = pgTable(
  "gift_events",
  {
    id: serial("id").primaryKey(),
    uid: varchar("uid", { length: 128 }).notNull(),
    nickname: varchar("nickname", { length: 120 }).notNull().default("Player"),
    avatar: text("avatar").notNull().default(""),
    team: varchar("team", { length: 8 }).notNull(),
    targetTower: varchar("target_tower", { length: 8 }).notNull(),
    diamonds: integer("diamonds").notNull(),
    multiplier: integer("multiplier").notNull().default(1),
    damage: integer("damage").notNull(),
    isCrit: boolean("is_crit").notNull().default(false),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gift_events_created_idx").on(t.createdAt)],
);

export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type GiftEventRow = typeof giftEvents.$inferSelect;
