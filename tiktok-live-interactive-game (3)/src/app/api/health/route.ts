import { db, isDatabaseConfigured, requireDatabase } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireDatabase();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "connected" });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        database: isDatabaseConfigured ? "unreachable" : "not-configured",
        error: String((error as Error).message ?? error),
      },
      { status: 503 },
    );
  }
}
