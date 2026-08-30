import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import type { TeamListResponse, TeamsComparisonResponse } from "@app/shared"
import { getBudgetStatus, getBudgetStatusOrNull } from "../api/budget.ts"
import { getTeamsComparison } from "../api/comparison.ts"
import { listFlags } from "../api/flags.ts"
import { getTeams } from "../api/lookup.ts"
import {
  getAdoption,
  getCost,
  getFlagsSummary,
  getInProgress,
  getOutcomes,
  getReliability,
  getSpeed,
  getSummary,
} from "../api/metrics.ts"
import { searchRuns } from "../api/runs.ts"
import { getTrend } from "../api/trend.ts"
import { BudgetPaceBar } from "../components/BudgetPaceBar.tsx"
import { CostNumberLine } from "../components/CostNumberLine.tsx"
import { DateRangePicker, type DateRange } from "../components/DateRangePicker.tsx"
import { FailureGroups } from "../components/FailureGroups.tsx"
import { FlagsTable } from "../components/FlagsTable.tsx"
import { PageHead, TopBar } from "../components/PageHeader.tsx"
import { PairedCard } from "../components/PairedStat.tsx"
import { buildRunRow } from "../components/runRow.ts"
import { RunsTable } from "../components/RunsTable.tsx"
import { SectionEmpty, SectionState } from "../components/SectionState.tsx"
import { Sparkline } from "../components/Sparkline.tsx"
import { BarLegend, StackedBar } from "../components/StackedBar.tsx"
import { TeamComparisonScatter } from "../components/TeamComparisonScatter.tsx"
import { findEngineer, findTeamName } from "../lib/directory.ts"
import { computeHero } from "../lib/hero.ts"
import { formatCount, formatDuration, formatPercent } from "../lib/format.ts"
import { formatDollarsAndCents, formatDollarsWhole } from "../lib/money.ts"
import { useSection } from "../lib/useSection.ts"

const RECENT_RUNS_LIMIT = 25

const OUTPUT_LABEL: Record<string, string> = {
  pull_request: "🔀 opened",
  commit: "💾",
  file: "📄",
  report: "📊",
}

/** One team's budget row for the org page's table -- `null` status means the team hasn't set a
 *  budget for this month yet (a plain 404 from `budget-status`, not a section-wide failure). */
type BudgetRow = { teamId: string; teamName: string; status: Awaited<ReturnType<typeof getBudgetStatus>> | null }

async function loadBudgetRows(teams: TeamListResponse): Promise<BudgetRow[]> {
  return Promise.all(
    teams.map(async (team) => ({
      teamId: team.id,
      teamName: team.name,
      status: await getBudgetStatusOrNull({ team: team.id }),
    })),
  )
}

export function OrgPage() {
  const [range, setRange] = useState<DateRange | null>(null)
  const from = range?.from
  const to = range?.to

  const [hoursSavedPerTask, setHoursSavedPerTask] = useState<number | null>(null)
  const [engineerHourlyCostCents, setEngineerHourlyCostCents] = useState<number | null>(null)

  const summary = useSection(() => getSummary({ from, to }), [from, to])
  const adoption = useSection(() => getAdoption({}), [])
  const outcomes = useSection(() => getOutcomes({ from, to }), [from, to])
  const cost = useSection(() => getCost({ from, to }), [from, to])
  const reliability = useSection(() => getReliability({ from, to }), [from, to])
  const speed = useSection(() => getSpeed({ from, to }), [from, to])
  const flagsSummary = useSection(() => getFlagsSummary({ from, to }), [from, to])
  const flags = useSection(() => listFlags({ from, to, limit: 50 }), [from, to])
  const inProgress = useSection(() => getInProgress({}), [])
  const orgTrend = useSection(() => getTrend({ interval: "week" }), [])
  const teamsComparison = useSection<TeamsComparisonResponse>(() => getTeamsComparison({ from, to }), [from, to])
  const budgetRows = useSection(async () => {
    const teams = await getTeams()
    const [rows, orgStatus] = await Promise.all([loadBudgetRows(teams), getBudgetStatus({})])
    return { rows, teamsWithoutBudget: orgStatus.teamsWithoutBudget ?? 0 }
  }, [])

  // Recent runs -- Fix 1 from the product feedback: an org page used to have no way to reach a
  // run except drilling org -> team -> engineer -> run. This is "recent," not "in this window,"
  // so it deliberately ignores the date range above, same as the Engineer page's own recent-runs
  // table -- a browsing list, not a metric the picker should ever silently reshape.
  const recentRuns = useSection(async () => {
    const page = await searchRuns({ limit: RECENT_RUNS_LIMIT })
    const rows = await Promise.all(
      page.items.map(async (run) => {
        const [engineer, teamName] = await Promise.all([
          run.engineerId ? findEngineer(run.engineerId) : Promise.resolve(null),
          findTeamName(run.teamId),
        ])
        return buildRunRow(run, { engineerName: engineer?.name ?? null, teamName })
      }),
    )
    return { rows, total: page.total }
  }, [])

  // The two hero dials start at the server's own defaults (docs/api.md: "$85 an hour, 1.0 hours
  // saved per finished task") the first time summary data arrives, then stay put -- a refetch
  // (the date range changing) must never stomp on a number a person already typed over it.
  useEffect(() => {
    if (summary.status === "ready" && hoursSavedPerTask === null) {
      setHoursSavedPerTask(summary.data.defaults.hoursSavedPerTask)
      setEngineerHourlyCostCents(summary.data.defaults.engineerHourlyCostCents)
    }
  }, [summary.status])

  const hero = useMemo(() => {
    if (summary.status !== "ready" || hoursSavedPerTask === null || engineerHourlyCostCents === null) return null
    return computeHero({
      finishedTasks: summary.data.finishedTasks,
      moneySpentCents: summary.data.moneySpentCents,
      hoursSavedPerTask,
      engineerHourlyCostCents,
    })
  }, [summary, hoursSavedPerTask, engineerHourlyCostCents])

  const sortedBudgetRows = useMemo(() => {
    if (budgetRows.status !== "ready") return []
    return budgetRows.data.rows
      .filter((r): r is BudgetRow & { status: NonNullable<BudgetRow["status"]> } => r.status !== null)
      .sort((a, b) => b.status.projectedLandingCents / b.status.limitCents - a.status.projectedLandingCents / a.status.limitCents)
  }, [budgetRows])

  const noRunsYet = summary.status === "ready" && summary.data.finishedTasks === 0

  return (
    <>
      <TopBar crumbs={[{ label: "Org overview" }]} active="org" />
      <PageHead
        title="Org overview"
        description="Is this paying for itself, and is anything going wrong I can't see?"
        right={<DateRangePicker defaultPreset="30d" onRangeChange={setRange} />}
      />

      <SectionState state={inProgress.status === "loading" ? "loading" : inProgress.status === "error" ? "error" : "ready"} errorMessage={inProgress.status === "error" ? inProgress.message : undefined} onRetry={inProgress.retry}>
        {inProgress.status === "ready" && (
          <div className="callout neutral" style={{ marginBottom: 18 }}>
            🔄 {formatCount(inProgress.data.count)} run{inProgress.data.count === 1 ? "" : "s"} in progress right now ·{" "}
            {formatDollarsWhole(inProgress.data.costSoFarCents)} already spent — kept apart from every finished-run number below,
            not folded in and not missing.
          </div>
        )}
      </SectionState>

      {noRunsYet ? (
        <SectionEmpty>
          No runs yet. Once engineers start using it, this page fills in — check back after day one.
        </SectionEmpty>
      ) : (
        <>
          {/* HERO -- the one number: money spent against value returned. */}
          <SectionState
            state={summary.status}
            errorMessage={summary.status === "error" ? summary.message : undefined}
            onRetry={summary.retry}
          >
            {summary.status === "ready" && hero && hoursSavedPerTask !== null && engineerHourlyCostCents !== null && (
              <>
                <div className="hero">
                  <div className="hero-top">
                    <div className="hero-title">
                      Money spent vs. value returned
                      <span>Two guesses drive this — change them and the totals move.</span>
                    </div>
                    <div className="hero-inputs">
                      <div className="input-box">
                        <label htmlFor="hours-saved">Hours saved per task</label>
                        <div className="field">
                          <input
                            id="hours-saved"
                            type="number"
                            step={0.5}
                            min={0}
                            value={hoursSavedPerTask}
                            onChange={(e) => setHoursSavedPerTask(Number(e.target.value) || 0)}
                          />
                          <span className="unit">hrs</span>
                        </div>
                      </div>
                      <div className="input-box">
                        <label htmlFor="hourly-cost">Cost of an engineer hour</label>
                        <div className="field">
                          <span className="unit">$</span>
                          <input
                            id="hourly-cost"
                            type="number"
                            step={5}
                            min={0}
                            value={engineerHourlyCostCents / 100}
                            onChange={(e) => setEngineerHourlyCostCents(Math.round((Number(e.target.value) || 0) * 100))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="hero-result">
                    <div className="col">
                      <div className="stat-note">
                        Value returned
                        <br />
                        <span style={{ fontSize: 11 }}>
                          {formatCount(summary.data.finishedTasks)} finished tasks × {hoursSavedPerTask} hr × {formatDollarsAndCents(engineerHourlyCostCents, 0)}
                        </span>
                      </div>
                      <div className="stat">{formatDollarsWhole(hero.valueReturnedCents)}</div>
                    </div>
                    <div className="col">
                      <div className="stat-note">
                        Money spent
                        <br />
                        <span style={{ fontSize: 11 }}>every run, failures included</span>
                      </div>
                      <div className="stat">{formatDollarsWhole(hero.moneySpentCents)}</div>
                    </div>
                    <div className={`col hero-net${hero.netCents < 0 ? " negative" : ""}`}>
                      <div className="stat-note">Net</div>
                      <div className="stat">
                        {hero.netCents >= 0 ? "+" : "-"}
                        {formatDollarsWhole(Math.abs(hero.netCents))}
                      </div>
                    </div>
                  </div>
                </div>

                {hero.breakEvenMinutes !== null && (
                  <div className="breakeven">
                    At {formatDollarsAndCents(Math.round(summary.data.moneySpentCents / summary.data.finishedTasks))} a finished task
                    against a {formatDollarsAndCents(engineerHourlyCostCents, 0)} engineer hour, this pays for itself the moment a
                    task saves more than <b>about {Math.round(hero.breakEvenMinutes)} minutes</b>.
                  </div>
                )}
              </>
            )}
          </SectionState>

          {/* ADOPTION */}
          <div className="section">
            <div className="section-title">
              Adoption — are people using it<span className="rule" />
              <span className="hint">fixed 7d/30d windows — doesn't move with the picker above</span>
            </div>
            <SectionState state={adoption.status} errorMessage={adoption.status === "error" ? adoption.message : undefined} onRetry={adoption.retry}>
              {adoption.status === "ready" && (
                <div className="grid g3">
                  <div className="card">
                    <div className="card-label">Adoption rate — last 30 days</div>
                    <div className="stat">{formatPercent(adoption.data.adoptionRate.last30d.rate)}</div>
                    <div className="stat-note">
                      {adoption.data.adoptionRate.last30d.activeEngineers}/{adoption.data.adoptionRate.last30d.licensedSeats} seats · last 7 days{" "}
                      {formatPercent(adoption.data.adoptionRate.last7d.rate)}
                    </div>
                    <div className="bar-track" style={{ marginTop: 10 }}>
                      <div className="bar-fill" style={{ width: `${adoption.data.adoptionRate.last30d.rate * 100}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-label">Sticking rate — last 7 days</div>
                    <div className="stat">{formatPercent(adoption.data.stickingRate.rate)}</div>
                    <div className="stat-note">
                      {adoption.data.stickingRate.activeInLast7d}/{adoption.data.stickingRate.everRun} who ever tried it, active in the last 7 days
                    </div>
                    <div className="bar-track" style={{ marginTop: 10 }}>
                      <div className="bar-fill" style={{ width: `${adoption.data.stickingRate.rate * 100}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-label">Depth of use — {adoption.data.depthOfUse.totalSeats} seats, last 30 days</div>
                    <StackedBar
                      segments={[
                        { key: "deep", value: adoption.data.depthOfUse.deep, colorVar: "var(--scale-1)" },
                        { key: "regular", value: adoption.data.depthOfUse.regular, colorVar: "var(--scale-2)" },
                        { key: "light", value: adoption.data.depthOfUse.light, colorVar: "var(--scale-3)" },
                        { key: "dormant", value: adoption.data.depthOfUse.dormant, colorVar: "var(--scale-4)" },
                      ]}
                    />
                    <BarLegend
                      items={[
                        { emoji: "🚀", label: `${adoption.data.depthOfUse.deep}` },
                        { emoji: "🔧", label: `${adoption.data.depthOfUse.regular}` },
                        { emoji: "🌱", label: `${adoption.data.depthOfUse.light}` },
                        { emoji: "💤", label: `${adoption.data.depthOfUse.dormant}` },
                      ]}
                    />
                  </div>
                </div>
              )}
            </SectionState>
          </div>

          {/* OUTCOME */}
          <div className="section">
            <div className="section-title">
              Outcome — did anything useful come out<span className="rule" />
            </div>
            <SectionState state={outcomes.status} errorMessage={outcomes.status === "error" ? outcomes.message : undefined} onRetry={outcomes.retry}>
              {outcomes.status === "ready" && (
                <>
                  <div className="grid g2">
                    <PairedCard
                      label="Success rate — last 7 & 30 days, fixed (not the range above)"
                      left={
                        <>
                          <div className="stat-note">First try</div>
                          <div className="stat md">{formatPercent(outcomes.data.successRate.last30d.firstTry.rate)}</div>
                          {orgTrend.status === "ready" && (
                            <Sparkline
                              points={orgTrend.data.points.map((p) => p.successRateFirstTry)}
                              ariaLabel="First-try success rate, recent weeks"
                            />
                          )}
                          <div className="stat-note">last 7d {formatPercent(outcomes.data.successRate.last7d.firstTry.rate)}</div>
                        </>
                      }
                      right={
                        <>
                          <div className="stat-note">In the end</div>
                          <div className="stat md">{formatPercent(outcomes.data.successRate.last30d.eventual.rate)}</div>
                          <div className="stat-note">last 7d {formatPercent(outcomes.data.successRate.last7d.eventual.rate)}</div>
                        </>
                      }
                      footnote={`${formatCount(outcomes.data.successRate.last30d.cancelledEarly)} cancelled early — counted apart, in neither number.`}
                    />
                    <PairedCard
                      label="Finished tasks — next to rework, always"
                      left={
                        <>
                          <div className="stat-note">Finished tasks</div>
                          <div className="stat md">{formatCount(outcomes.data.finishedTasks)}</div>
                          {orgTrend.status === "ready" && (
                            <Sparkline points={orgTrend.data.points.map((p) => p.finishedTasks)} ariaLabel="Finished tasks trend" />
                          )}
                        </>
                      }
                      right={
                        <>
                          <div className="stat-note">Rework rate</div>
                          <div className="stat md">{formatPercent(outcomes.data.reworkRate.rate, 1)}</div>
                        </>
                      }
                      footnote="Merged changes reverted or rewritten within 14 days."
                    />
                  </div>
                  <div className="grid g2" style={{ marginTop: 14 }}>
                    <div className="card">
                      <div className="card-label">What came out</div>
                      <div className="table-scroll">
                        <table>
                          <tbody>
                            {outcomes.data.outputs.map((o) => (
                              <tr key={o.kind}>
                                <td>{OUTPUT_LABEL[o.kind]}</td>
                                <td className="num">{formatCount(o.count)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td>🔀 merged</td>
                              <td className="num">
                                {formatCount(outcomes.data.mergedPullRequests)} (
                                {formatPercent(outcomes.data.mergedPullRequests / (outcomes.data.outputs.find((o) => o.kind === "pull_request")?.count || 1))}
                                )
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="stat-note">🔀 merged is what counts — unmerged helped no one.</div>
                    </div>
                    <PairedCard
                      label="Runs per week — next to success rate, always"
                      left={
                        <>
                          <div className="stat-note">Runs this week</div>
                          <div className="stat md">
                            {orgTrend.status === "ready" ? formatCount(orgTrend.data.points[orgTrend.data.points.length - 1]?.runsStarted ?? 0) : "—"}
                          </div>
                          {orgTrend.status === "ready" && (
                            <Sparkline points={orgTrend.data.points.map((p) => p.runsStarted)} ariaLabel="Runs per week trend" />
                          )}
                        </>
                      }
                      right={
                        <>
                          <div className="stat-note">Success, first try</div>
                          <div className="stat md">
                            {orgTrend.status === "ready" ? formatPercent(orgTrend.data.points[orgTrend.data.points.length - 1]?.successRateFirstTry ?? 0) : "—"}
                          </div>
                          {orgTrend.status === "ready" && (
                            <Sparkline points={orgTrend.data.points.map((p) => p.successRateFirstTry)} ariaLabel="First-try success rate per week" />
                          )}
                        </>
                      }
                      footnote="Last several weeks, org-wide."
                    />
                  </div>
                </>
              )}
            </SectionState>
          </div>

          {/* MONEY */}
          <div className="section">
            <div className="section-title">
              Money<span className="rule" />
            </div>
            <SectionState state={cost.status} errorMessage={cost.status === "error" ? cost.message : undefined} onRetry={cost.retry}>
              {cost.status === "ready" && (
                <div className="grid g2">
                  <div className="card">
                    <div className="card-label">Cost per finished task — median leads</div>
                    <CostNumberLine
                      medianCents={cost.data.costPerFinishedTask.medianCents}
                      averageCents={cost.data.costPerFinishedTask.averageCents}
                      worstCents={cost.data.costPerFinishedTask.worstCents}
                    />
                    <div className="stat-note">
                      Median leads — one runaway run drags the average, not the median. Failed attempts count too, so
                      cheap-but-flaky can cost more than reliable-but-pricier.
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-label">Tokens used — separate from money, on purpose</div>
                    <StackedBar
                      segments={[
                        { key: "fresh", value: cost.data.tokensUsed.freshInput, colorVar: "var(--scale-1)" },
                        { key: "cached", value: cost.data.tokensUsed.cachedInput, colorVar: "var(--scale-2)" },
                        { key: "output", value: cost.data.tokensUsed.output, colorVar: "var(--scale-3)" },
                        { key: "thinking", value: cost.data.tokensUsed.thinking, colorVar: "var(--scale-4)" },
                      ]}
                    />
                    <BarLegend
                      items={[
                        { swatch: "var(--scale-1)", label: `Fresh input ${(cost.data.tokensUsed.freshInput / 1e6).toFixed(0)}M` },
                        { swatch: "var(--scale-2)", label: `Cached input ${(cost.data.tokensUsed.cachedInput / 1e6).toFixed(0)}M` },
                        { swatch: "var(--scale-3)", label: `Output ${(cost.data.tokensUsed.output / 1e6).toFixed(0)}M` },
                        { swatch: "var(--scale-4)", label: `Thinking ${(cost.data.tokensUsed.thinking / 1e6).toFixed(0)}M` },
                      ]}
                    />
                    <div className="stat-note" style={{ marginTop: 8 }}>
                      Cached runs ~1/10 the price of fresh — this shows volume, not spend.
                    </div>
                  </div>
                </div>
              )}
            </SectionState>
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-label">Budget by team — worst pace first</div>
              <SectionState state={budgetRows.status} errorMessage={budgetRows.status === "error" ? budgetRows.message : undefined} onRetry={budgetRows.retry}>
                {budgetRows.status === "ready" && (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th>Spent / limit</th>
                            <th>Used</th>
                            <th style={{ width: 220 }}>Pace</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedBudgetRows.map(({ teamId, teamName, status }) => {
                            const usedPct = status.limitCents > 0 ? Math.round((status.spentSoFarCents / status.limitCents) * 100) : 0
                            return (
                              <tr key={teamId}>
                                <td>
                                  <Link to={`/teams/${teamId}`}>{teamName}</Link>
                                </td>
                                <td className="num">
                                  {formatDollarsWhole(status.spentSoFarCents)} / {formatDollarsWhole(status.limitCents)}
                                </td>
                                <td className="num">{usedPct}%</td>
                                <td>
                                  <BudgetPaceBar status={status} />
                                </td>
                                <td>
                                  {status.stopLineCrossed ? (
                                    <span className="pill pill-bad">over stop line</span>
                                  ) : status.warnLineCrossed ? (
                                    <span className="pill pill-warn">past warning</span>
                                  ) : (
                                    <span className="pill pill-good">on pace</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="stat-note">
                      Dashed = day of month gone. Worst pace first — a spend list, not a ranking.
                      {budgetRows.data.teamsWithoutBudget > 0 &&
                        ` ${budgetRows.data.teamsWithoutBudget} team${budgetRows.data.teamsWithoutBudget === 1 ? "" : "s"} haven't set a budget yet and aren't in this table.`}
                    </div>
                  </>
                )}
              </SectionState>
            </div>
          </div>

          {/* RELIABILITY */}
          <div className="section">
            <div className="section-title">
              Reliability — what broke, whose problem<span className="rule" />
              <span className="hint">failure rate below is a fixed 7d/30d window — doesn't move with the picker above</span>
            </div>
            <SectionState state={reliability.status} errorMessage={reliability.status === "error" ? reliability.message : undefined} onRetry={reliability.retry}>
              {reliability.status === "ready" && (
                <>
                  <div className="card">
                    <div className="card-label">
                      Failure rate, last 30 days: {formatPercent(reliability.data.failureRate.last30d.byBlame.reduce((s, b) => s + b.rate, 0), 1)} of ended
                      runs, by who can fix it
                    </div>
                    <FailureGroups window={reliability.data.failureRate.last30d} />
                    <div className="caption">
                      Cancelled by a person: {formatPercent(reliability.data.failureRate.last30d.cancelled / reliability.data.failureRate.last30d.endedRuns, 1)}{" "}
                      of all runs — tracked apart, not a failure.
                    </div>
                  </div>
                  <div className="grid g3" style={{ marginTop: 14 }}>
                    <div className="card">
                      <div className="card-label">Quiet failures</div>
                      <div className="stat sm">
                        {formatCount(reliability.data.quietFailures.count)} runs <span className="pill pill-bad" style={{ marginLeft: 6 }}>flagged</span>
                      </div>
                      <div className="stat-note">Reported success without doing the job — nothing else flags it.</div>
                    </div>
                    <div className="card">
                      <div className="card-label">Retry rate</div>
                      <div className="stat sm">{formatPercent(reliability.data.retryRate.rate)}</div>
                      <div className="stat-note">Needed more than one run — real money on redoing work.</div>
                    </div>
                    <div className="card">
                      <div className="card-label">Time before giving up</div>
                      <div className="stat sm">
                        p50 {formatDuration(reliability.data.timeBeforeGivingUp.p50Ms)} · p95 {formatDuration(reliability.data.timeBeforeGivingUp.p95Ms)}
                      </div>
                      <div className="stat-note">Catches slow failures that burn budget before anyone notices.</div>
                    </div>
                  </div>
                </>
              )}
            </SectionState>
          </div>

          {/* TEAM COMPARISON */}
          <div className="section">
            <div className="section-title">
              Teams, compared fairly<span className="rule" />
              <span className="hint">not a ranking — a small team's one bad run should not read as a real signal</span>
            </div>
            <SectionState state={teamsComparison.status} errorMessage={teamsComparison.status === "error" ? teamsComparison.message : undefined} onRetry={teamsComparison.retry}>
              {teamsComparison.status === "ready" && (
                <div className="card">
                  <div className="card-label">Success rate vs. run count</div>
                  <TeamComparisonScatter points={teamsComparison.data.teams} orgRate={teamsComparison.data.org.rate} />
                  <div className="caption">
                    The band is the range luck alone would produce, given each team's run count. A team is only called out
                    when it sits outside it — that's the one worth a look, not the lowest raw number.
                  </div>
                </div>
              )}
            </SectionState>
          </div>

          {/* SPEED */}
          <div className="section">
            <div className="section-title">
              Speed<span className="rule" />
            </div>
            <SectionState state={speed.status} errorMessage={speed.status === "error" ? speed.message : undefined} onRetry={speed.retry}>
              {speed.status === "ready" && (
                <div className="card">
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>p50</th>
                          <th>p95</th>
                          <th>p99</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Turn time — one model reply</td>
                          <td className="num">{formatDuration(speed.data.turnTime.p50Ms)}</td>
                          <td className="num">{formatDuration(speed.data.turnTime.p95Ms)}</td>
                          <td className="num">{formatDuration(speed.data.turnTime.p99Ms)}</td>
                        </tr>
                        <tr>
                          <td>Run time — whole task, finished runs</td>
                          <td className="num">{formatDuration(speed.data.runTime.p50Ms)}</td>
                          <td className="num">{formatDuration(speed.data.runTime.p95Ms)}</td>
                          <td className="num">{formatDuration(speed.data.runTime.p99Ms)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="caption">
                    {formatCount(speed.data.timedOutRuns)} runs timed out — kept out of the numbers above, so cut-off runs can't
                    look like "getting faster."
                  </div>
                </div>
              )}
            </SectionState>
          </div>

          {/* FLAGS */}
          <div className="section">
            <div className="section-title">
              Rules — an agent tried something it shouldn't<span className="rule" />
            </div>
            <SectionState state={flagsSummary.status} errorMessage={flagsSummary.status === "error" ? flagsSummary.message : undefined} onRetry={flagsSummary.retry}>
              {flagsSummary.status === "ready" && (
                <div className="card">
                  <div className="stat-note" style={{ fontSize: 13, marginBottom: 12 }}>
                    {flagsSummary.data.bySeverity.map((s, i) => (
                      <span key={s.severity}>
                        {i > 0 && " · "}
                        {s.severity === "high" ? "🔴" : s.severity === "medium" ? "🟠" : "⚪"} {s.count}
                      </span>
                    ))}
                  </div>
                  <SectionState state={flags.status} errorMessage={flags.status === "error" ? flags.message : undefined} onRetry={flags.retry}>
                    {flags.status === "ready" && <FlagsTable items={flags.data.items} teamNameFor={(item) => item.teamName} />}
                  </SectionState>
                  <div className="caption">Ranked by new-for-this-team, not by count.</div>
                </div>
              )}
            </SectionState>
          </div>

          {/* RECENT RUNS -- reachable directly, not only by drilling through a team and an
              engineer first. */}
          <div className="section">
            <div className="section-title">
              Recent runs<span className="rule" />
              <span className="hint">click any row for the full run</span>
            </div>
            <SectionState state={recentRuns.status} errorMessage={recentRuns.status === "error" ? recentRuns.message : undefined} onRetry={recentRuns.retry}>
              {recentRuns.status === "ready" && (
                <div className="card">
                  <RunsTable rows={recentRuns.data.rows} showTeam />
                  <div className="stat-note" style={{ marginTop: 10 }}>
                    Showing the {formatCount(recentRuns.data.rows.length)} most recent of {formatCount(recentRuns.data.total)} runs, org-wide.
                  </div>
                </div>
              )}
            </SectionState>
          </div>
        </>
      )}
    </>
  )
}
