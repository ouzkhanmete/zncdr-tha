import { expect, test } from "bun:test"
import type { Budget, Team } from "@app/shared"
import type { BudgetRepository } from "../repositories/budgets.ts"
import type { DailyCostTotal } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"
import {
  BudgetService,
  buildDailySpend,
  burnPace,
  isPastStopLine,
  isPastWarningLine,
  monthWindow,
  projectedLandingCents,
  shareOfMonthGone,
} from "./budget.ts"
import { makeFakeRunRepository } from "./test-helpers.ts"

function fakeBudgetRepo(overrides: Partial<BudgetRepository>): BudgetRepository {
  return {
    findById: () => undefined,
    findByTeamAndMonth: () => undefined,
    listByOrgAndMonth: () => [],
    upsert: () => {
      throw new Error("not used")
    },
    ...overrides,
  }
}

const fakeRunRepo = makeFakeRunRepository

function fakeTeamRepo(overrides: Partial<TeamRepository>): TeamRepository {
  return {
    create: () => {
      throw new Error("not used")
    },
    findById: () => undefined,
    listByOrgId: () => [],
    ...overrides,
  }
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 1,
    teamId: 1,
    month: "2026-06",
    limitCents: 100,
    warnCents: 80,
    stopCents: 100,
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  }
}

function team(overrides: Partial<Team>): Team {
  return { id: 1, orgId: 1, name: "Nova", createdAt: "2026-01-01T00:00:00Z", ...overrides }
}

// ---------------------------------------------------------------------------
// Calendar maths -- docs/testing.md "Budget — burn pace".
// ---------------------------------------------------------------------------

test("month window covers the whole UTC month, half-open", () => {
  expect(monthWindow("2026-02")).toEqual({ from: "2026-02-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" })
  // A leap-relevant month, just to be sure daysInMonth isn't hard-coded.
  expect(monthWindow("2028-02")).toEqual({ from: "2028-02-01T00:00:00.000Z", to: "2028-03-01T00:00:00.000Z" })
})

test("share of month gone: day 10 of a 30-day month is 10/30, not 9/30", () => {
  // June has 30 days.
  expect(shareOfMonthGone("2026-06", "2026-06-10T15:00:00Z")).toBeCloseTo(10 / 30, 10)
  expect(shareOfMonthGone("2026-06", "2026-06-28T09:00:00Z")).toBeCloseTo(28 / 30, 10)
})

test("share of month gone reads as fully spent for a month already in the past, and untouched for one not yet started", () => {
  expect(shareOfMonthGone("2026-06", "2026-08-01T00:00:00Z")).toBe(1)
  expect(shareOfMonthGone("2026-06", "2026-04-01T00:00:00Z")).toBe(0)
})

test("burn pace on day 10 and day 28 tell two completely different stories from the same 80% spent", () => {
  // docs/testing.md's worked example: 80% of budget spent, once 10 days into a 30-day month and
  // once 28 days in. Same bar, very different pace.
  const day10Pace = burnPace(80, 100, 10 / 30)
  const day28Pace = burnPace(80, 100, 28 / 30)

  expect(day10Pace).toBeCloseTo(2.4, 10)
  expect(day28Pace).toBeCloseTo(0.857, 2)
  expect(day10Pace!).toBeGreaterThan(day28Pace!)
})

test("burn pace has no answer without a budget to measure against, or before the month starts", () => {
  expect(burnPace(80, 0, 10 / 30)).toBeNull()
  expect(burnPace(0, 100, 0)).toBeNull()
})

test("projected landing is spend so far divided by share of month gone, rounded once", () => {
  expect(projectedLandingCents(800, 10 / 30)).toBe(Math.round(800 / (10 / 30)))
  // Nothing to project from yet -- falls back to today's spend instead of dividing by zero.
  expect(projectedLandingCents(0, 0)).toBe(0)
  expect(projectedLandingCents(500, 0)).toBe(500)
})

// ---------------------------------------------------------------------------
// The warning and stop lines, exactly on the boundary -- docs/testing.md.
// ---------------------------------------------------------------------------

test("a team exactly at its warning line is warned, not a cent under and not requiring a cent over", () => {
  expect(isPastWarningLine(8_000, 8_000)).toBe(true)
  expect(isPastWarningLine(7_999, 8_000)).toBe(false)
})

test("a team exactly at its stop line is stopped, same boundary rule as the warning line", () => {
  expect(isPastStopLine(10_000, 10_000)).toBe(true)
  expect(isPastStopLine(9_999, 10_000)).toBe(false)
})

test("a team one cent under either line is flagged as neither warned nor stopped", () => {
  const warnCents = 8_000
  const stopCents = 10_000
  expect(isPastWarningLine(warnCents - 1, warnCents)).toBe(false)
  expect(isPastStopLine(warnCents - 1, stopCents)).toBe(false)
})

test("a team can be past its warning line without yet being over its stop line", () => {
  const warnCents = 8_000
  const stopCents = 10_000
  const spent = stopCents - 1
  expect(isPastWarningLine(spent, warnCents)).toBe(true)
  expect(isPastStopLine(spent, stopCents)).toBe(false)
})

// ---------------------------------------------------------------------------
// The daily spend chart.
// ---------------------------------------------------------------------------

test("daily spend fills in a running total for every day, including days with nothing spent", () => {
  const totals: DailyCostTotal[] = [
    { date: "2026-06-01", costCents: 100 },
    { date: "2026-06-03", costCents: 50 },
  ]
  const points = buildDailySpend(totals, "2026-06", "2026-06-04T12:00:00Z")

  expect(points).toEqual([
    { date: "2026-06-01", cumulativeSpentCents: 100 },
    { date: "2026-06-02", cumulativeSpentCents: 100 }, // nothing spent, total carried forward
    { date: "2026-06-03", cumulativeSpentCents: 150 },
    { date: "2026-06-04", cumulativeSpentCents: 150 },
  ])
})

test("daily spend runs through today for the current month, and through month end for a past one", () => {
  const currentMonth = buildDailySpend([], "2026-06", "2026-06-04T00:00:00Z")
  expect(currentMonth).toHaveLength(4)

  const pastMonth = buildDailySpend([{ date: "2026-06-15", costCents: 10 }], "2026-06", "2026-08-01T00:00:00Z")
  expect(pastMonth).toHaveLength(30)
  expect(pastMonth[pastMonth.length - 1]).toEqual({ date: "2026-06-30", cumulativeSpentCents: 10 })
})

test("daily spend for a month that hasn't started yet is empty, not a stretch of zeros", () => {
  expect(buildDailySpend([], "2026-12", "2026-06-01T00:00:00Z")).toEqual([])
})

// ---------------------------------------------------------------------------
// The service -- team scope.
// ---------------------------------------------------------------------------

test("a team with no budget set for the month has no status to report", () => {
  const service = new BudgetService(fakeBudgetRepo({}), fakeRunRepo({}), fakeTeamRepo({}))
  expect(service.getTeamBudgetStatus(1, 1, "2026-06", "2026-06-10T00:00:00Z")).toBeNull()
})

test("a team's budget status carries its lines, its pace, and both boundary flags together", () => {
  const b = budget({ teamId: 5, limitCents: 100, warnCents: 80, stopCents: 100 })
  const dailyTotals: DailyCostTotal[] = [{ date: "2026-06-10", costCents: 80 }]
  const service = new BudgetService(
    fakeBudgetRepo({ findByTeamAndMonth: () => b }),
    fakeRunRepo({ listDailyCostTotals: () => dailyTotals }),
    fakeTeamRepo({}),
  )

  const status = service.getTeamBudgetStatus(1, 5, "2026-06", "2026-06-10T12:00:00Z")

  expect(status).not.toBeNull()
  expect(status!.scope).toBe("team")
  expect(status!.teamId).toBe(5)
  expect(status!.limitCents).toBe(100)
  expect(status!.spentSoFarCents).toBe(80)
  expect(status!.monthProgress).toBeCloseTo(10 / 30, 10)
  expect(status!.pace).toBeCloseTo(2.4, 10)
  expect(status!.warnLineCrossed).toBe(true) // exactly at the warning line
  expect(status!.stopLineCrossed).toBe(false)
  expect(status!.dailySpend.length).toBe(10)
})

test("a team past its stop line is reported stopped, not just a bar reading over 100%", () => {
  const b = budget({ teamId: 5, limitCents: 100, warnCents: 80, stopCents: 100 })
  const service = new BudgetService(
    fakeBudgetRepo({ findByTeamAndMonth: () => b }),
    fakeRunRepo({ listDailyCostTotals: () => [{ date: "2026-06-05", costCents: 150 }] }),
    fakeTeamRepo({}),
  )

  const status = service.getTeamBudgetStatus(1, 5, "2026-06", "2026-06-05T00:00:00Z")
  expect(status!.stopLineCrossed).toBe(true)
  expect(status!.warnLineCrossed).toBe(true)
})

// ---------------------------------------------------------------------------
// The service -- org scope.
// ---------------------------------------------------------------------------

test("org budget status adds every budgeted team's lines and spend, and counts the rest apart", () => {
  const teamA = budget({ teamId: 1, limitCents: 1_000, warnCents: 800, stopCents: 1_000 })
  const teamB = budget({ teamId: 2, limitCents: 2_000, warnCents: 1_600, stopCents: 2_000 })
  const allTeams: Team[] = [team({ id: 1 }), team({ id: 2 }), team({ id: 3, name: "Comet" })] // team 3 has no budget

  const service = new BudgetService(
    fakeBudgetRepo({ listByOrgAndMonth: () => [teamA, teamB] }),
    fakeRunRepo({
      listDailyCostTotals: (_orgId, _window, filters) => {
        if (filters?.teamId === 1) return [{ date: "2026-06-10", costCents: 500 }]
        if (filters?.teamId === 2) return [{ date: "2026-06-10", costCents: 300 }]
        return []
      },
    }),
    fakeTeamRepo({ listByOrgId: () => allTeams }),
  )

  const status = service.getOrgBudgetStatus(1, "2026-06", "2026-06-10T00:00:00Z")

  expect(status.scope).toBe("org")
  expect(status.limitCents).toBe(3_000)
  expect(status.warnCents).toBe(2_400)
  expect(status.stopCents).toBe(3_000)
  expect(status.spentSoFarCents).toBe(800) // 500 + 300, merged by date across teams
  expect(status.teamsWithoutBudget).toBe(1) // team 3
})

test("an org with no budgets set anywhere reports zeroed totals, not a crash", () => {
  const service = new BudgetService(
    fakeBudgetRepo({ listByOrgAndMonth: () => [] }),
    fakeRunRepo({}),
    fakeTeamRepo({ listByOrgId: () => [team({ id: 1 }), team({ id: 2 })] }),
  )
  const status = service.getOrgBudgetStatus(1, "2026-06", "2026-06-10T00:00:00Z")
  expect(status.limitCents).toBe(0)
  expect(status.teamsWithoutBudget).toBe(2)
  expect(status.spentSoFarCents).toBe(0)
  expect(status.pace).toBeNull() // nothing to divide by with a zero limit
})
