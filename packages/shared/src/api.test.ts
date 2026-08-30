import { describe, expect, test } from "bun:test"
import { BudgetInput, FlagListItem, SummaryResponse, TaskAttempt, TeamsComparisonResponse } from "./api.ts"

describe("budgets", () => {
  test("rejects a budget whose warning line sits above its stop line", () => {
    const result = BudgetInput.safeParse({
      month: "2026-08",
      limitCents: 500_000,
      warnCents: 480_000,
      stopCents: 400_000,
    })
    expect(result.success).toBe(false)
  })

  test("accepts a budget whose warning line sits below its stop line", () => {
    const result = BudgetInput.safeParse({
      month: "2026-08",
      limitCents: 500_000,
      warnCents: 400_000,
      stopCents: 450_000,
    })
    expect(result.success).toBe(true)
  })
})

describe("SummaryResponse", () => {
  const validExample = {
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-30T00:00:00Z",
    finishedTasks: 42,
    moneySpentCents: 125_000,
    defaults: { hoursSavedPerTask: 0.5, engineerHourlyCostCents: 8_500 },
  }

  test("accepts a correct example", () => {
    expect(SummaryResponse.safeParse(validExample).success).toBe(true)
  })

  test("rejects a money field written as a float", () => {
    const withFloatMoney = { ...validExample, moneySpentCents: 1250.5 }
    expect(SummaryResponse.safeParse(withFloatMoney).success).toBe(false)
  })
})

test("a stop line above the limit is refused by the API, not left to the database", () => {
  // Without this rule the value passes checking, reaches the raw table CHECK, and the
  // person setting a budget gets an unexplained failure instead of being told what is wrong.
  const bad = BudgetInput.safeParse({
    month: "2026-08",
    limitCents: 180_000,
    warnCents: 144_000,
    stopCents: 200_000, // above the limit
  })
  expect(bad.success).toBe(false)

  // The normal shape from docs/seed-data.md: warn at 80% of the limit, stop at 100%.
  const good = BudgetInput.safeParse({
    month: "2026-08",
    limitCents: 180_000,
    warnCents: 144_000,
    stopCents: 180_000,
  })
  expect(good.success).toBe(true)
})

describe("FlagListItem", () => {
  test("accepts a row with team info -- the org-wide flags table's shape", () => {
    const result = FlagListItem.safeParse({
      id: "flag-1",
      runId: "run-1",
      kind: "blocked_domain_attempt",
      severity: "medium",
      status: "under_review",
      isNewKindForScope: true,
      createdAt: "2026-08-01T00:00:00Z",
      teamId: "nova",
      teamName: "Nova",
    })
    expect(result.success).toBe(true)
  })

  test("rejects a row missing team info -- a real reply always sends it, even scoped to one team", () => {
    // Step 7 (docs/plan.md) dropped the `.optional()` this field used to carry: it existed only
    // so the web app's own stand-in sample data could typecheck before it read the real API.
    // Every row on the wire -- org-wide or already scoped to one team -- carries both fields
    // (docs/api.md section 4: "a caller that already scoped its own request with `team` already
    // knows the answer and can ignore them" -- ignore, not receive as absent).
    const result = FlagListItem.safeParse({
      id: "flag-1",
      runId: "run-1",
      kind: "blocked_domain_attempt",
      severity: "medium",
      status: "under_review",
      isNewKindForScope: true,
      createdAt: "2026-08-01T00:00:00Z",
    })
    expect(result.success).toBe(false)
  })
})

describe("TaskAttempt", () => {
  test("accepts a failed attempt carrying why it failed", () => {
    const result = TaskAttempt.safeParse({
      runId: "run-1",
      attemptNumber: 1,
      status: "failed",
      startedAt: "2026-08-01T00:00:00Z",
      totalCostCents: 100,
      isSelf: false,
      failureCause: "tests_failed",
      blame: "task",
    })
    expect(result.success).toBe(true)
  })
})

describe("TeamsComparisonResponse", () => {
  test("accepts one point per team, each with a band sized to its own run count", () => {
    const result = TeamsComparisonResponse.safeParse({
      metric: "firstTry",
      from: "2026-07-31T00:00:00Z",
      to: "2026-08-29T00:00:00Z",
      org: { rate: 0.87, runCount: 2583 },
      teams: [
        { teamId: "nova", teamName: "Nova", rate: 0.72, runCount: 343, band: { low: 0.8, high: 0.94 }, withinBand: false },
        { teamId: "comet", teamName: "Comet", rate: 0.97, runCount: 60, band: { low: 0.7, high: 1 }, withinBand: true },
      ],
    })
    expect(result.success).toBe(true)
  })
})
