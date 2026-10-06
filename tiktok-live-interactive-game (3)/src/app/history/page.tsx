import Link from "next/link";
import { dayKey, overallStats, recentGifts, recentMatches, topLeaderboard } from "@/lib/game/persistence";

export const dynamic = "force-dynamic";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function duration(a: Date, b: Date) {
  const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback; // DB not configured or tables not created yet (see Admin → Create DB tables)
  }
}

export default async function HistoryPage() {
  const [stats, matches, gifts, leaders] = await Promise.all([
    safe(overallStats(), { matches: 0, redWins: 0, blueWins: 0, draws: 0, gifts: 0, diamonds: 0, damage: 0 }),
    safe(recentMatches(20), []),
    safe(recentGifts(30), []),
    safe(topLeaderboard(10), []),
  ]);

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <header className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight">📜 Match history &amp; leaderboard</h1>
          <p className="text-xs opacity-60 mt-1">Persisted in PostgreSQL · daily leaderboard resets at midnight UTC ({dayKey()})</p>
        </div>
        <nav className="flex gap-2 text-xs">
          <Link href="/" className="btn">🎮 Game overlay</Link>
          <Link href="/admin" className="btn btn-primary">🎛 Streamer panel</Link>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Matches played" value={fmt(stats.matches)} />
          <Stat label="Red / Blue / Draw" value={`${stats.redWins} / ${stats.blueWins} / ${stats.draws}`} />
          <Stat label="Gifts processed" value={fmt(stats.gifts)} sub={`💎 ${fmt(stats.diamonds)} diamonds`} />
          <Stat label="Total damage" value={fmt(stats.damage)} />
        </section>

        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
          <section className="panel">
            <h2>🏅 Today&apos;s leaders</h2>
            {leaders.length === 0 ? (
              <p className="text-xs opacity-50">No damage recorded today yet. Send a gift from the simulator!</p>
            ) : (
              <ol className="space-y-2">
                {leaders.map((l, i) => (
                  <li key={l.uid} className="flex items-center gap-3 text-sm">
                    <span className={`w-6 text-center font-black ${i === 0 ? "text-amber-300" : i === 1 ? "text-slate-300" : i === 2 ? "text-orange-300" : "opacity-50"}`}>{i + 1}</span>
                    {l.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.avatar} alt="" className="w-8 h-8 rounded-full object-cover border border-white/20" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10" />
                    )}
                    <span className="flex-1 truncate font-semibold">{l.nickname}</span>
                    <b className="tabular-nums">{fmt(l.damage)}</b>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel overflow-x-auto">
            <h2>Recent matches</h2>
            {matches.length === 0 ? (
              <p className="text-xs opacity-50">No completed matches yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="opacity-60 text-left">
                  <tr>
                    <th className="py-1 pr-2">Ended</th>
                    <th className="py-1 pr-2">Winner</th>
                    <th className="py-1 pr-2">How</th>
                    <th className="py-1 pr-2">HP R/B</th>
                    <th className="py-1 pr-2">Dmg R/B</th>
                    <th className="py-1 pr-2">MVP</th>
                    <th className="py-1 pr-2">Gifts</th>
                    <th className="py-1 pr-2">Len</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.id} className="border-t border-white/5">
                      <td className="py-1.5 pr-2 whitespace-nowrap opacity-80">{m.endedAt.toLocaleString("en-GB", { hour12: false })}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`font-black ${m.winner === "red" ? "text-red" : m.winner === "blue" ? "text-blue" : ""}`}>{m.winner.toUpperCase()}</span>
                      </td>
                      <td className="py-1.5 pr-2">{m.endReason === "destroyed" ? `🏰 ${m.destroyedTower} fell` : "⏱ timeout"}{m.suddenDeath ? " 🔥" : ""}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{m.redHp} / {m.blueHp}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{fmt(m.redDamage)} / {fmt(m.blueDamage)}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[120px]">{m.mvpNickname ?? "—"}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{m.giftCount}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{duration(m.startedAt, m.endedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="panel overflow-x-auto">
          <h2>Recent gift strikes</h2>
          {gifts.length === 0 ? (
            <p className="text-xs opacity-50">No gifts yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="opacity-60 text-left">
                <tr>
                  <th className="py-1 pr-2">Time</th>
                  <th className="py-1 pr-2">Viewer</th>
                  <th className="py-1 pr-2">Team</th>
                  <th className="py-1 pr-2">💎</th>
                  <th className="py-1 pr-2">Mult</th>
                  <th className="py-1 pr-2">Damage</th>
                  <th className="py-1 pr-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => (
                  <tr key={g.id} className="border-t border-white/5">
                    <td className="py-1.5 pr-2 whitespace-nowrap opacity-80">{g.createdAt.toLocaleTimeString("en-GB", { hour12: false })}</td>
                    <td className="py-1.5 pr-2 font-semibold truncate max-w-[140px]">{g.nickname}</td>
                    <td className="py-1.5 pr-2"><span className={g.team === "red" ? "text-red" : "text-blue"}>{g.team}</span> → {g.targetTower}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{g.diamonds}</td>
                    <td className="py-1.5 pr-2 tabular-nums">×{g.multiplier}</td>
                    <td className="py-1.5 pr-2 tabular-nums font-bold">{fmt(g.damage)}</td>
                    <td className="py-1.5 pr-2">{g.isCrit ? "💥 crit " : ""}{g.simulated ? "🧪 sim" : "📡 live"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel">
      <div className="text-[10px] uppercase tracking-widest opacity-60 font-bold">{label}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-60">{sub}</div>}
    </div>
  );
}
