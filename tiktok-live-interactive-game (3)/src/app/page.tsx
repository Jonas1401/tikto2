import Link from "next/link";
import GameStage from "@/components/game/GameStage";

export const dynamic = "force-dynamic";

/**
 * Main game overlay. Designed as a 9:16 portrait stage so it can be captured
 * directly into a TikTok Live stream (OBS browser source / screen share).
 * Add `?compact=1` to hide the hint panel, or `?clean=1` to hide the side nav.
 */
export default async function GamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const compact = sp.compact === "1";
  const clean = sp.clean === "1";

  return (
    <main className="min-h-screen flex items-stretch justify-center bg-[#0b0612]">
      <div className="relative flex items-center justify-center w-full">
        <div className="h-[100dvh] max-h-[100dvh] aspect-[9/16] max-w-full">
          <div className="w-full h-full [&>.stage]:w-full [&>.stage]:h-full">
            <GameStage compact={compact} />
          </div>
        </div>

        {!clean && (
          <nav className="hidden md:flex flex-col gap-2 absolute right-4 top-4 text-xs">
            <Link href="/admin" className="btn btn-primary">🎛 Streamer panel</Link>
            <Link href="/history" className="btn">📜 Match history</Link>
            <Link href="/?clean=1" className="btn">🎥 Clean overlay</Link>
          </nav>
        )}
      </div>
    </main>
  );
}
