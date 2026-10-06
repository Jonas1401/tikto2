import { getEngine } from "@/lib/game/engine";
import { tiktokInfo } from "@/lib/game/tiktok";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine();
  return Response.json({
    ok: true,
    snapshot: engine.snapshot(),
    tiktok: tiktokInfo(),
    clients: engine.listenerCount,
  });
}
