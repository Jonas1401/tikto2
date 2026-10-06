import { getEngine } from "@/lib/game/engine";
import { ensureAutoConnect } from "@/lib/game/tiktok";
import type { GameEvent } from "@/lib/game/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby allows up to 60s per streaming response (300s on Pro).
// The browser auto-reconnects (retry: 2000) and receives a fresh `init` snapshot.
export const maxDuration = 60;

/**
 * Server-Sent Events stream. Replaces the Socket.IO channel of the original project.
 * Every browser (game overlay, admin panel) subscribes here.
 */
export async function GET(req: Request) {
  const engine = getEngine();
  ensureAutoConnect();
  await engine.refreshLeaderboard();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: GameEvent) => {
        try {
          controller.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      controller.enqueue(encoder.encode(`retry: 2000\n\n`));
      send({ type: "init", data: engine.snapshot() });
      unsubscribe = engine.subscribe(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 15_000);

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
