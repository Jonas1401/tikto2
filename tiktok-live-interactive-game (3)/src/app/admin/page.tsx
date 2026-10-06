import Link from "next/link";
import AdminPanel from "@/components/admin/AdminPanel";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <header className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight">
            🏰 Tower Battle — <span className="bg-gradient-to-r from-pink-400 to-violet-400 bg-clip-text text-transparent">Streamer Panel</span>
          </h1>
          <p className="text-xs opacity-60 mt-1">
            Control the live match, connect your TikTok account, and simulate viewer activity for testing.
          </p>
        </div>
        <nav className="flex gap-2 text-xs">
          <Link href="/" className="btn">🎮 Game overlay</Link>
          <Link href="/history" className="btn">📜 History</Link>
        </nav>
      </header>
      <div className="max-w-7xl mx-auto">
        <AdminPanel />
      </div>
    </main>
  );
}
