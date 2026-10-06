import { overallStats, recentGifts, recentMatches } from "@/lib/game/persistence";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [matches, gifts, stats] = await Promise.all([recentMatches(20), recentGifts(30), overallStats()]);
    return Response.json({ ok: true, matches, gifts, stats });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
