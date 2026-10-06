import { dayKey, topLeaderboard } from "@/lib/game/persistence";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const top = await topLeaderboard(10);
    return Response.json({ ok: true, top, dayKey: dayKey() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
