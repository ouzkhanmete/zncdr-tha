import { useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { getEngineerOverview, getEngineerRuns, getEngineerTrend } from "../api/engineers.ts"
import { DateRangePicker, type DateRange } from "../components/DateRangePicker.tsx"
import { LineChart } from "../components/LineChart.tsx"
import { PageHead, TopBar } from "../components/PageHeader.tsx"
import { PairedCard } from "../components/PairedStat.tsx"
import { SectionEmpty, SectionState } from "../components/SectionState.tsx"
import { findEngineer } from "../lib/directory.ts"
import { formatDollarsAndCents } from "../lib/money.ts"
import { formatCount, formatDuration, formatPercent, formatUtcDate } from "../lib/format.ts"
import { useSection } from "../lib/useSection.ts"

const DEPTH_EMOJI: Record<string, string> = { deep: "🚀", regular: "🔧", light: "🌱", dormant: "💤" }
const DEPTH_LABEL: Record<string, string> = { deep: "Deep", regular: "Regular", light: "Light", dormant: "Dormant" }
const OUTPUT_EMOJI: Record<string, string> = { pull_request: "🔀", commit: "💾", file: "📄", report: "📊" }

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
}

type LinkState = { name?: string; teamId?: string; teamName?: string } | null

export function EngineerPage() {
  const { engineerId } = useParams()
  const location = useLocation()
  const linkState = location.state as LinkState

  const [range, setRange] = useState<DateRange | null>(null)
  const from = range?.from
  const to = range?.to

  // A team member's link already carries their name and team (see TeamPage's roster links) --
  // that fast path skips a fetch entirely. A direct visit (a bookmark, a link from the Run page)
  // has no such state, so it falls back to the org-wide directory -- see lib/directory.ts for why
  // no single endpoint answers "whose id is this" on its own.
  const identity = useSection(async () => {
    if (linkState?.name && linkState.teamId && linkState.teamName) {
      return { id: engineerId!, name: linkState.name, teamId: linkState.teamId, teamName: linkState.teamName }
    }
    return findEngineer(engineerId!)
  }, [engineerId])

  const overview = useSection(() => getEngineerOverview(engineerId!, { from, to }), [engineerId, from, to])
  const trend = useSection(() => getEngineerTrend(engineerId!, { from, to, interval: "week" }), [engineerId, from, to])
  const runs = useSection(() => getEngineerRuns(engineerId!, { limit: 25 }), [engineerId])

  const displayName = identity.status === "ready" && identity.data ? identity.data.name : (engineerId ?? "Engineer")
  const teamId = identity.status === "ready" && identity.data ? identity.data.teamId : null
  const teamName = identity.status === "ready" && identity.data ? identity.data.teamName : null

  return (
    <>
      <TopBar
        crumbs={[
          { label: "Org", to: "/" },
          ...(teamId && teamName ? [{ label: `Team: ${teamName}`, to: `/teams/${teamId}` }] : []),
          { label: displayName },
        ]}
        active="engineer"
      />
      <PageHead
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="avatar">{initials(displayName)}</span>
            {displayName}
          </span>
        }
        description="Is this helping me? Only against their own past — never a teammate's number."
        right={<DateRangePicker defaultPreset="90d" onRangeChange={setRange} />}
      />

      {/* RIGHT NOW */}
      <div className="section">
        <div className="section-title">
          Right now<span className="rule" />
          <span className="hint">🚀 deep · 🔧 regular · 🌱 light · 💤 dormant</span>
        </div>
        <SectionState state={overview.status} errorMessage={overview.status === "error" ? overview.message : undefined} onRetry={overview.retry}>
          {overview.status === "ready" && (
            <div className="card">
              <div className="stat">
                {DEPTH_EMOJI[overview.data.depthOfUse]} {DEPTH_LABEL[overview.data.depthOfUse]}
              </div>
              <div className="stat-note">Over the selected window — own history only, never a teammate's bucket.</div>
            </div>
          )}
        </SectionState>
      </div>

      {overview.status === "ready" && overview.data.finishedTasks === 0 && runs.status === "ready" && runs.data.items.length === 0 ? (
        <SectionEmpty>No runs yet. Once they start, their own trend builds up here — there's nothing to compare them to but themselves.</SectionEmpty>
      ) : (
        <>
          {/* OWN TRENDS */}
          <div className="section">
            <div className="section-title">
              Own trend<span className="rule" />
            </div>
            <SectionState state={overview.status} errorMessage={overview.status === "error" ? overview.message : undefined} onRetry={overview.retry}>
              {overview.status === "ready" && (
                <div className="grid g3">
                  <div className="card">
                    <div className="card-label">
                      Success rate<span style={{ textTransform: "none", fontWeight: 400 }}> — ✅ first try · 🔁 in the end</span>
                    </div>
                    <div className="stat sm">
                      ✅ {formatPercent(overview.data.successRate.firstTry.rate)} · 🔁 {formatPercent(overview.data.successRate.eventual.rate)}
                    </div>
                    {trend.status === "ready" && (
                      <LineChart
                        width={300}
                        height={90}
                        series={[{ key: "firstTry", colorVar: "var(--accent)", points: trend.data.points.map((p) => p.successRateFirstTry) }]}
                        endLabel={(s) => `✅ ${formatPercent(s.points[s.points.length - 1]!)}`}
                        ariaLabel="First-try success rate over the selected window"
                      />
                    )}
                    <div className="stat-note">First-try trend shown; "in the end" has no per-week series to chart yet — see this page's own numbers above.</div>
                  </div>

                  <PairedCard
                    label="Finished tasks, next to quiet failures"
                    left={
                      <>
                        <div className="stat-note">Finished, this window</div>
                        {trend.status === "ready" && (
                          <LineChart
                            width={130}
                            height={74}
                            series={[{ key: "finished", colorVar: "var(--accent)", points: trend.data.points.map((p) => p.finishedTasks) }]}
                            ariaLabel="Finished tasks over the selected window"
                          />
                        )}
                        <div className="stat-note" style={{ textAlign: "center" }}>{formatCount(overview.data.finishedTasks)}</div>
                      </>
                    }
                    right={
                      <>
                        <div className="stat-note">Quiet failures</div>
                        <div className="stat sm" style={{ textAlign: "center" }}>{formatCount(overview.data.quietFailures)}</div>
                      </>
                    }
                    footnote="Reported success without doing the job, if any — this person's own count, not a comparison."
                  />

                  <div className="card">
                    <div className="card-label">Cost per finished task</div>
                    {trend.status === "ready" && (
                      <LineChart
                        width={300}
                        height={90}
                        series={[{ key: "cost", colorVar: "var(--accent)", points: trend.data.points.map((p) => p.medianCostPerFinishedTaskCents ?? 0) }]}
                        endLabel={(s) => formatDollarsAndCents(s.points[s.points.length - 1]!)}
                        ariaLabel="Median cost per finished task over the selected window"
                      />
                    )}
                    <div className="stat-note">
                      Median {formatDollarsAndCents(overview.data.costPerFinishedTask.medianCents)} · average{" "}
                      {formatDollarsAndCents(overview.data.costPerFinishedTask.averageCents)} · worst{" "}
                      {formatDollarsAndCents(overview.data.costPerFinishedTask.worstCents)} — against their own past only.
                    </div>
                  </div>
                </div>
              )}
            </SectionState>
          </div>

          {/* RUN HISTORY */}
          <div className="section" style={{ marginTop: 32 }}>
            <div className="section-title">
              Recent runs<span className="rule" />
              <span className="hint">click any row for the full run</span>
            </div>
            <SectionState state={runs.status} errorMessage={runs.status === "error" ? runs.message : undefined} onRetry={runs.retry}>
              {runs.status === "ready" &&
                (runs.data.items.length === 0 ? (
                  <SectionEmpty>No runs yet. Once they start, their own trend builds up here — there's nothing to compare them to but themselves.</SectionEmpty>
                ) : (
                  <div className="card">
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Task</th>
                            <th>Agent</th>
                            <th className="mid">Out</th>
                            <th className="mid">✅/❌</th>
                            <th>Cost</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runs.data.items.map((run) => (
                            <tr key={run.id} className="rowlink">
                              <td>{formatUtcDate(run.startedAt)}</td>
                              <td>
                                <Link to={`/runs/${run.id}`}>{run.taskSummary}</Link>
                              </td>
                              <td>{run.agentKind}</td>
                              <td className="mid">{run.primaryOutputKind ? OUTPUT_EMOJI[run.primaryOutputKind] : "—"}</td>
                              <td className="mid">{run.status === "succeeded" ? "✅" : run.status === "failed" ? "❌" : run.status}</td>
                              <td className="num">{formatDollarsAndCents(run.totalCostCents)}</td>
                              <td className="num">{run.durationMs !== null ? formatDuration(run.durationMs) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="stat-note" style={{ marginTop: 10 }}>🔀 pull request · 💾 commit · 📄 file · 📊 report</div>
                  </div>
                ))}
            </SectionState>
          </div>
        </>
      )}
    </>
  )
}
