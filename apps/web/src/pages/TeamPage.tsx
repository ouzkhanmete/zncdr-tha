import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { getBudgetStatusOrNull } from "../api/budget.ts"
import { getFilterOptions } from "../api/lookup.ts"
import { getCost, getOutcomes, getReliability } from "../api/metrics.ts"
import { searchRuns } from "../api/runs.ts"
import { getTrend } from "../api/trend.ts"
import { listFlags } from "../api/flags.ts"
import { BudgetBurnChart } from "../components/BudgetBurnChart.tsx"
import { CostNumberLine } from "../components/CostNumberLine.tsx"
import { DateRangePicker, type DateRange } from "../components/DateRangePicker.tsx"
import { FailureGroups } from "../components/FailureGroups.tsx"
import { FlagsTable } from "../components/FlagsTable.tsx"
import { LineChart } from "../components/LineChart.tsx"
import { PageHead, TopBar } from "../components/PageHeader.tsx"
import { PairedCard } from "../components/PairedStat.tsx"
import { buildRunRow } from "../components/runRow.ts"
import { RunsTable } from "../components/RunsTable.tsx"
import { SectionEmpty, SectionState } from "../components/SectionState.tsx"
import { dominantCause } from "../lib/failureCallout.ts"
import { formatCount, formatPercent } from "../lib/format.ts"
import { formatDollarsWhole } from "../lib/money.ts"
import { useSection } from "../lib/useSection.ts"
import { findEngineer, findTeamName } from "../lib/directory.ts"

const CAUSE_LABEL: Record<string, string> = {
  missing_secret_or_login: "one missing secret",
  missing_permission: "one missing permission",
}

const ORG_SETUP_CAUSES = ["missing_secret_or_login", "missing_permission", "tool_not_available", "network_or_sandbox_blocked", "hit_token_or_time_limit"]

const RECENT_RUNS_LIMIT = 25

export function TeamPage() {
  const { teamId } = useParams()
  const [range, setRange] = useState<DateRange | null>(null)
  const from = range?.from
  const to = range?.to

  const teamName = useSection(() => findTeamName(teamId!), [teamId])
  const budget = useSection(() => getBudgetStatusOrNull({ team: teamId }), [teamId])
  const outcomes = useSection(() => getOutcomes({ team: teamId, from, to }), [teamId, from, to])
  const orgOutcomes = useSection(() => getOutcomes({ from, to }), [from, to])
  const dailyTrend = useSection(() => getTrend({ team: teamId, interval: "day", from, to }), [teamId, from, to])
  const cost = useSection(() => getCost({ team: teamId, from, to }), [teamId, from, to])
  const reliability = useSection(() => getReliability({ team: teamId, from, to }), [teamId, from, to])
  const orgReliability = useSection(() => getReliability({ from, to }), [from, to])
  const flags = useSection(() => listFlags({ team: teamId, from, to, limit: 50 }), [teamId, from, to])
  const roster = useSection(() => getFilterOptions(teamId), [teamId])

  // Recent runs -- Fix 1 from the product feedback: a team page used to have no way to reach a
  // run except drilling into an engineer first. "Recent," not "in this window": it deliberately
  // ignores the date range above, same as the Engineer page's own recent-runs table.
  const recentRuns = useSection(async () => {
    const page = await searchRuns({ team: teamId, limit: RECENT_RUNS_LIMIT })
    const rows = await Promise.all(
      page.items.map(async (run) => {
        const engineer = run.engineerId ? await findEngineer(run.engineerId) : null
        return buildRunRow(run, { engineerName: engineer?.name ?? null })
      }),
    )
    return { rows, total: page.total }
  }, [teamId])

  const orgSetupOrgAvg = useMemo(() => {
    if (orgReliability.status !== "ready") return null
    const total = orgReliability.data.failureRate.last30d.byBlame.find((b) => b.blame === "org_setup")
    return total?.rate ?? null
  }, [orgReliability])

  const dominant = useMemo(() => {
    if (reliability.status !== "ready") return null
    const orgSetupCauses = reliability.data.failureRate.last30d.byCause.filter((c) => ORG_SETUP_CAUSES.includes(c.cause))
    return dominantCause(orgSetupCauses)
  }, [reliability])

  const runsThisWindow = dailyTrend.status === "ready" ? dailyTrend.data.points.reduce((s, d) => s + d.runsStarted, 0) : null
  const noRunsInWindow = runsThisWindow === 0

  const sortedRoster = useMemo(() => {
    if (roster.status !== "ready") return []
    return [...roster.data.engineers].sort((a, b) => a.name.localeCompare(b.name))
  }, [roster])

  const name = teamName.status === "ready" ? (teamName.data ?? teamId!) : teamId!

  return (
    <>
      <TopBar crumbs={[{ label: "Org", to: "/" }, { label: `Team: ${name}` }]} active="team" />
      <PageHead
        title={`Team: ${name}`}
        description="Is my team getting value, is anything stuck or breaking, am I about to blow my budget?"
        right={<DateRangePicker defaultPreset="7d" onRangeChange={setRange} />}
      />

      {/* BUDGET -- first and biggest, the one thing a manager can act on. */}
      <div className="section">
        <div className="section-title">
          💰 Budget<span className="rule" />
          <span className="hint">the one thing on this page a manager can act on today</span>
        </div>
        <div className="card">
          <SectionState state={budget.status} errorMessage={budget.status === "error" ? budget.message : undefined} onRetry={budget.retry}>
            {budget.status === "ready" &&
              (budget.data === null ? (
                <div className="stat-note">No budget has been set for this team this month.</div>
              ) : (
                <>
                  <div className="card-label">Spend this month against the team's limit</div>
                  <div className="stat">
                    {formatDollarsWhole(budget.data.spentSoFarCents)}{" "}
                    <span style={{ fontSize: 15, color: "var(--ink-soft)", fontWeight: 400 }}>
                      / {formatDollarsWhole(budget.data.limitCents)} ·{" "}
                      {budget.data.limitCents > 0 ? Math.round((budget.data.spentSoFarCents / budget.data.limitCents) * 100) : 0}% used
                    </span>
                  </div>
                  <BudgetBurnChart status={budget.data} />
                  <div className="stat-note">
                    Percent-used alone can't tell day 10 from day 28 apart. The pace line can
                    {budget.data.stopLineCrossed ? " — and this one is already past the stop line before the month is." : "."}
                  </div>
                </>
              ))}
          </SectionState>
        </div>
      </div>

      {noRunsInWindow && <SectionEmpty>No runs yet in this window. Widen the date range above, or check back once the team has run something.</SectionEmpty>}

      {/* OUTCOME */}
      <div className="section">
        <div className="section-title">
          Outcome<span className="rule" />
        </div>
        <SectionState state={outcomes.status} errorMessage={outcomes.status === "error" ? outcomes.message : undefined} onRetry={outcomes.retry}>
          {outcomes.status === "ready" && (
            <div className="grid g2">
              <PairedCard
                label="Runs — next to success rate, always"
                left={
                  <>
                    <div className="mini-head">
                      <span className="mv">{runsThisWindow !== null ? formatCount(runsThisWindow) : "—"}</span>
                      <span className="ml">runs in this window</span>
                    </div>
                    {dailyTrend.status === "ready" && (
                      <LineChart
                        series={[{ key: "runs", colorVar: "var(--accent)", points: dailyTrend.data.points.map((d) => d.runsStarted) }]}
                        ariaLabel="Runs per day in this window"
                      />
                    )}
                  </>
                }
                right={
                  <>
                    <div className="mini-head">
                      <span className="mv">
                        {formatPercent(outcomes.data.successRate.last7d.firstTry.rate)}{" "}
                        <span style={{ fontWeight: 400, color: "var(--ink-soft)", fontSize: 13 }}>→ {formatPercent(outcomes.data.successRate.last7d.eventual.rate)}</span>
                      </span>
                      <span className="ml">first try → in the end, last 7 days (fixed)</span>
                    </div>
                    {dailyTrend.status === "ready" && (
                      <LineChart
                        series={[{ key: "firstTry", colorVar: "var(--accent)", points: dailyTrend.data.points.map((d) => d.successRateFirstTry) }]}
                        ariaLabel="First-try success rate per day in this window"
                      />
                    )}
                  </>
                }
                footnote="Success rate above is a fixed 7d/30d figure — it doesn't move with the picker; the trend line below it does."
              />
              <PairedCard
                label="Finished tasks — next to rework, always"
                left={
                  <>
                    <div className="mini-head">
                      <span className="mv">{formatCount(outcomes.data.finishedTasks)}</span>
                      <span className="ml">finished in this window</span>
                    </div>
                    {dailyTrend.status === "ready" && (
                      <LineChart
                        series={[{ key: "finished", colorVar: "var(--accent)", points: dailyTrend.data.points.map((d) => d.finishedTasks) }]}
                        ariaLabel="Finished tasks per day in this window"
                      />
                    )}
                  </>
                }
                right={
                  <>
                    <div className="mini-head">
                      <span className="mv">{formatPercent(outcomes.data.reworkRate.rate, 1)}</span>
                      <span className="ml">
                        rework{orgOutcomes.status === "ready" && ` · org avg ${formatPercent(orgOutcomes.data.reworkRate.rate, 1)}`}
                      </span>
                    </div>
                  </>
                }
              />
            </div>
          )}
        </SectionState>
      </div>

      {/* MONEY */}
      <div className="section">
        <div className="section-title">
          Cost<span className="rule" />
        </div>
        <SectionState state={cost.status} errorMessage={cost.status === "error" ? cost.message : undefined} onRetry={cost.retry}>
          {cost.status === "ready" && (
            <div className="card">
              <div className="card-label">Cost per finished task — median leads, one runaway run can't drag it</div>
              <CostNumberLine
                medianCents={cost.data.costPerFinishedTask.medianCents}
                averageCents={cost.data.costPerFinishedTask.averageCents}
                worstCents={cost.data.costPerFinishedTask.worstCents}
              />
            </div>
          )}
        </SectionState>
      </div>

      {/* RELIABILITY */}
      <div className="section">
        <div className="section-title">
          What broke, and whose problem it is<span className="rule" />
          <span className="hint">this afternoon's fix list · failure rate is a fixed last-30-days window</span>
        </div>
        <SectionState state={reliability.status} errorMessage={reliability.status === "error" ? reliability.message : undefined} onRetry={reliability.retry}>
          {reliability.status === "ready" && (
            <div className="card">
              <FailureGroups
                window={reliability.data.failureRate.last30d}
                groupNotes={orgSetupOrgAvg !== null ? { org_setup: `org avg ${formatPercent(orgSetupOrgAvg, 1)}` } : undefined}
              />
              {dominant && (
                <div className="stat-note" style={{ marginTop: 10 }}>
                  Nearly all of this team's org-setup failures trace to {CAUSE_LABEL[dominant.cause] ?? dominant.cause} — closing that
                  would close most of this group. These are the fixable-this-afternoon kind.
                </div>
              )}
            </div>
          )}
        </SectionState>
      </div>

      {/* FLAGS */}
      <div className="section">
        <div className="section-title">
          Rules, this team<span className="rule" />
          <span className="hint">newest kind first, not highest count</span>
        </div>
        <SectionState state={flags.status} errorMessage={flags.status === "error" ? flags.message : undefined} onRetry={flags.retry}>
          {flags.status === "ready" && (
            <div className="card">
              <div className="sev-key">🔴 high &nbsp; 🟠 medium &nbsp; ⚪ low</div>
              <FlagsTable items={flags.data.items} />
            </div>
          )}
        </SectionState>
      </div>

      {/* TEAM MEMBERS */}
      <div className="section">
        <div className="section-title">
          👥 Team members<span className="rule" />
          <span className="hint">names only — no scores, no ranking</span>
        </div>
        <SectionState state={roster.status} errorMessage={roster.status === "error" ? roster.message : undefined} onRetry={roster.retry}>
          {roster.status === "ready" && (
            <div className="card">
              <div className="roster">
                {sortedRoster.map((m) => (
                  <Link key={m.id} to={`/engineers/${m.id}`} state={{ name: m.name, teamId, teamName: name }}>
                    {m.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </SectionState>
      </div>

      {/* RECENT RUNS -- reachable directly, not only by drilling into an engineer first. */}
      <div className="section">
        <div className="section-title">
          Recent runs<span className="rule" />
          <span className="hint">click any row for the full run</span>
        </div>
        <SectionState state={recentRuns.status} errorMessage={recentRuns.status === "error" ? recentRuns.message : undefined} onRetry={recentRuns.retry}>
          {recentRuns.status === "ready" && (
            <div className="card">
              <RunsTable rows={recentRuns.data.rows} />
              <div className="stat-note" style={{ marginTop: 10 }}>
                Showing the {formatCount(recentRuns.data.rows.length)} most recent of {formatCount(recentRuns.data.total)} runs for this team.
              </div>
            </div>
          )}
        </SectionState>
      </div>
    </>
  )
}
