import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Accept the conventional DATABASE_URL as well as names created by Vercel
// Postgres/Neon integrations. Creating a Pool does not establish a connection,
// so a local placeholder keeps route modules importable during `next build`.
const configuredDatabaseUrl =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

export const isDatabaseConfigured = Boolean(configuredDatabaseUrl);

export function requireDatabase(): void {
  if (!isDatabaseConfigured) {
    throw new Error(
      "Database is not configured. Add DATABASE_URL (or POSTGRES_URL) in the Vercel environment variables.",
    );
  }
}

const databaseUrl =
  configuredDatabaseUrl || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    // Serverless instances should not reserve a large connection pool each.
    max: process.env.VERCEL ? 2 : 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
