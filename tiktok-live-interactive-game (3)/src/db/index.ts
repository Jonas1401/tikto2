import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Accepts the standard DATABASE_URL as well as the variable names that
// Vercel Postgres / Neon integrations create automatically.
const databaseUrl =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL (or POSTGRES_URL) is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
