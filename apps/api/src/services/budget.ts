/**
 * Group 3 — Money: budget state, burn pace, the projection to month end, and the warning/stop
 * lines. Matches docs/metrics.md's "Budget and burn pace" exactly. See docs/decisions.md entry 10
 * for why this arithmetic lives here rather than in SQL.
 *
 * Money in and out of this file is whole cents, as an integer, always. `monthProgress` and burn
 * pace are plain ratios (0 and up), not money, so they're never rounded to a cent boundary.
 */

import { sumCents } from "@app/shared"
import type { Budget } from "@app/shared"
import type { BudgetRepository } from "../repositories/budgets.ts"
import type { DailyCostTotal, RunRepository } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"
import type { DateWindow } from "../repositories/types.ts"

// ---------------------------------------------------------------------------
// Pure calendar and money maths -- no repository needed, so each rule can be pinned down in
// isolation. See docs/testing.md's "Budget — burn pace" and "Budget — warning line vs. stop line".
// ---------------------------------------------------------------------------

function parseMonth(month: string): { year: number; monthIndex: number } {
  const [yearText, monthText] = month.split("-")
  return { year: Number(yearText), monthIndex: Number(monthText) - 1 }
}

/** How many days are in a given UTC month. `monthIndex` is 0-based, same as `Date`'s. */
function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of next month is the last day of this one -- a plain, correct way to ask a UTC-based
  // Date "how long is this month" without a lookup table or leap-year special case.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** The half-open window covering a whole `"YYYY-MM"` month, in UTC -- what a repository call
 *  needs to fetch that month's rows. */
export function monthWindow(month: string): DateWindow {
  const { year, monthIndex } = parseMonth(month)
  return {
    from: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    to: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
  }
}

/**
 * Share of the month gone, as of `nowIso` -- the bottom of the burn-pace fraction.
 *
 * A month already fully in the past reads as 1 (entirely gone); a month that hasn't started yet
 * reads as 0. Otherwise it's today's day-of-month over the month's day count, e.g. the 10th of a
 * 30-day month is 10/30 -- matching docs/testing.md's worked example exactly, where "10 days into
 * a 30-day month" means the fraction 10/30, not 9/30.
 */
export function shareOfMonthGone(month: string, nowIso: string): number {
  const { year, monthIndex } = parseMonth(month)
  const now = new Date(nowIso)
  const nowYear = now.getUTCFullYear()
  const nowMonthIndex = now.getUTCMonth()

  if (nowYear > year || (nowYear === year && nowMonthIndex > monthIndex)) return 1
  if (nowYear < year || (nowYear === year && nowMonthIndex < monthIndex)) return 0
  return now.getUTCDate() / daysInMonth(year, monthIndex)
}

/**
 * Pace = (spent so far ÷ the limit) ÷ (share of the month gone) -- docs/testing.md's own formula:
 * 80% of budget spent 10 days into a 30-day month is pace 0.80 ÷ (10/30) = 2.4, "well past on
 * track"; the same 80% on day 28 is pace 0.80 ÷ (28/30) ≈ 0.86, "basically on track". Same
 * "80% spent" bar, a completely different number once time is folded in -- that's the entire
 * reason this exists instead of just showing the percentage spent.
 *
 * `null` when there's nothing to divide by: no budget limit set, or a month that hasn't started.
 */
export function burnPace(spentSoFarCents: number, limitCents: number, monthProgress: number): number | null {
  if (limitCents <= 0 || monthProgress <= 0) return null
  return spentSoFarCents / limitCents / monthProgress
}

/**
 * Where this pace lands by month end -- docs/metrics.md's "Landing on".
 *
 * projected landing = spent so far ÷ share of month gone.
 *
 * Rounded once, here, to the nearest whole cent -- the only rounding point for this figure.
 * `monthProgress` of 0 (a month that hasn't started) has nothing to project from yet, so this
 * falls back to whatever has been spent so far -- normally zero.
 */
export function projectedLandingCents(spentSoFarCents: number, monthProgress: number): number {
  if (monthProgress <= 0) return spentSoFarCents
  return Math.round(spentSoFarCents / monthProgress)
}

/** At or above the warning line counts as warned -- not a cent under, not strictly over. */
export function isPastWarningLine(spentSoFarCents: number, warnCents: number): boolean {
  return spentSoFarCents >= warnCents
}

/** At or above the stop line counts as stopped -- same boundary rule as the warning line. */
export function isPastStopLine(spentSoFarCents: number, stopCents: number): boolean {
  return spentSoFarCents >= stopCents
}

export interface DailySpendPoint {
  date: string // "YYYY-MM-DD"
  cumulativeSpentCents: number
}

/**
 * Turns a set of per-day totals (in any order, missing days allowed) into a running, cumulative
 * total for every UTC calendar day of the month from day 1 through "today" -- what the team
 * screen's burn chart draws its line from (docs/api.md's `dailySpend`). A day with no rows in
 * `dailyTotals` (nothing spent, or not reached yet) still gets a point, carrying the running total
 * forward at zero added -- a chart with a gap in it reads as a mistake, not as "nothing happened
 * that day".
 *
 * Stops at today for the current month (matching docs/api.md: "month start through today"), runs
 * all the way to month end for a month already finished, and comes back empty for a month that
 * hasn't started yet.
 */
export function buildDailySpend(
  dailyTotals: readonly DailyCostTotal[],
  month: string,
  nowIso: string,
): DailySpendPoint[] {
  const { year, monthIndex } = parseMonth(month)
  const now = new Date(nowIso)
  const nowYear = now.getUTCFullYear()
  const nowMonthIndex = now.getUTCMonth()

  const monthHasNotStarted = nowYear < year || (nowYear === year && nowMonthIndex < monthIndex)
  if (monthHasNotStarted) return []

  const monthIsCurrent = nowYear === year && nowMonthIndex === monthIndex
  const lastDay = monthIsCurrent ? now.getUTCDate() : daysInMonth(year, monthIndex)

  const costByDate = new Map(dailyTotals.map((d) => [d.date, d.costCents]))
  const points: DailySpendPoint[] = []
  let running = 0
  for (let day = 1; day <= lastDay; day++) {
    const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    running += costByDate.get(date) ?? 0
    points.push({ date, cumulativeSpentCents: running })
  }
  return points
}

function mergeDailyTotals(lists: readonly (readonly DailyCostTotal[])[]): DailyCostTotal[] {
  const byDate = new Map<string, number>()
  for (const list of lists) {
    for (const { date, costCents } of list) byDate.set(date, (byDate.get(date) ?? 0) + costCents)
  }
  return [...byDate.entries()].map(([date, costCents]) => ({ date, costCents }))
}

// ---------------------------------------------------------------------------
// The shapes this service hands back.
// ---------------------------------------------------------------------------

interface BudgetLines {
  limitCents: number
  warnCents: number
  stopCents: number
}

interface BurnState {
  spentSoFarCents: number
  monthProgress: number
  /** Not itself part of docs/api.md's `BudgetStatusResponse` -- `projectedLandingCents` already
   *  carries the same information as a dollar figure. Kept here as its own field because
   *  docs/testing.md names "burn pace" as its own number (the 2.4 / ~0.86 example) and it's
   *  cheap to hand back the ratio a screen would otherwise have to re-derive
   *  (`projectedLandingCents / limitCents`) itself. See the note handed back with this work. */
  pace: number | null
  projectedLandingCents: number
  warnLineCrossed: boolean
  stopLineCrossed: boolean
  dailySpend: DailySpendPoint[]
}

export interface TeamBudgetStatus extends BudgetLines, BurnState {
  scope: "team"
  teamId: number
  month: string
}

export interface OrgBudgetStatus extends BudgetLines, BurnState {
  scope: "org"
  month: string
  /** Teams with no budget set for this month -- left out of every total above, and counted here
   *  so they aren't silently missing. */
  teamsWithoutBudget: number
}

// ---------------------------------------------------------------------------
// The service.
// ---------------------------------------------------------------------------

export class BudgetService {
  constructor(
    private readonly budgets: BudgetRepository,
    private readonly runs: RunRepository,
    private readonly teams: TeamRepository,
  ) {}

  /** One team's budget lines, spend so far, pace, and projection for a month. `null` when this
   *  team has no budget set for that month -- there are no lines to measure spend against, the
   *  same "nothing set yet" case `GET /api/teams/:teamId/budget` reports with its own 404. */
  getTeamBudgetStatus(orgId: number, teamId: number, month: string, nowIso: string): TeamBudgetStatus | null {
    const budget = this.budgets.findByTeamAndMonth(teamId, month)
    if (!budget) return null

    const dailyTotals = this.runs.listDailyCostTotals(orgId, monthWindow(month), { teamId })
    return {
      scope: "team",
      teamId,
      month,
      ...this.lines(budget),
      ...this.burnState(dailyTotals, budget, month, nowIso),
    }
  }

  /** Every team's budget for a month, added into one org-wide figure. Teams with no budget for
   *  that month are left out of every sum and counted in `teamsWithoutBudget` instead of
   *  disappearing quietly. */
  getOrgBudgetStatus(orgId: number, month: string, nowIso: string): OrgBudgetStatus {
    const budgetedTeams = this.budgets.listByOrgAndMonth(orgId, month)
    const allTeams = this.teams.listByOrgId(orgId)
    const budgetedTeamIds = new Set(budgetedTeams.map((b) => b.teamId))
    const teamsWithoutBudget = allTeams.filter((t) => !budgetedTeamIds.has(t.id)).length

    const combinedLines: Budget = {
      id: 0,
      teamId: 0,
      month,
      limitCents: sumCents(budgetedTeams.map((b) => b.limitCents)),
      warnCents: sumCents(budgetedTeams.map((b) => b.warnCents)),
      stopCents: sumCents(budgetedTeams.map((b) => b.stopCents)),
      updatedAt: nowIso,
    }

    const window = monthWindow(month)
    const dailyTotals = mergeDailyTotals(
      budgetedTeams.map((b) => this.runs.listDailyCostTotals(orgId, window, { teamId: b.teamId })),
    )

    return {
      scope: "org",
      month,
      teamsWithoutBudget,
      ...this.lines(combinedLines),
      ...this.burnState(dailyTotals, combinedLines, month, nowIso),
    }
  }

  private lines(budget: BudgetLines): BudgetLines {
    return { limitCents: budget.limitCents, warnCents: budget.warnCents, stopCents: budget.stopCents }
  }

  private burnState(
    dailyTotals: readonly DailyCostTotal[],
    budget: BudgetLines,
    month: string,
    nowIso: string,
  ): BurnState {
    const dailySpend = buildDailySpend(dailyTotals, month, nowIso)
    const spentSoFarCents = dailySpend.length === 0 ? 0 : dailySpend[dailySpend.length - 1]!.cumulativeSpentCents
    const monthProgress = shareOfMonthGone(month, nowIso)
    return {
      spentSoFarCents,
      monthProgress,
      pace: burnPace(spentSoFarCents, budget.limitCents, monthProgress),
      projectedLandingCents: projectedLandingCents(spentSoFarCents, monthProgress),
      warnLineCrossed: isPastWarningLine(spentSoFarCents, budget.warnCents),
      stopLineCrossed: isPastStopLine(spentSoFarCents, budget.stopCents),
      dailySpend,
    }
  }
}
