import { expect, test } from "bun:test"
import type { PolicyFlagRepository, PolicyFlagWithTeam } from "../repositories/policy-flags.ts"
import { RulesService } from "./rules.ts"

let nextFlagId = 1

function makeFlag(overrides: Partial<PolicyFlagWithTeam> = {}): PolicyFlagWithTeam {
  return {
    id: nextFlagId++,
    runId: 1,
    turnId: null,
    kind: "unsafe_command",
    severity: "low",
    disposition: "confirmed",
    resource: null,
    createdAt: "2026-08-10T09:00:00Z",
    teamId: 1,
    teamName: "Nova",
    ...overrides,
  }
}

/** A fake repository that returns whatever a test tells it to -- see docs/testing.md section 1. */
function fakeFlagRepo(overrides: Partial<PolicyFlagRepository> = {}): PolicyFlagRepository {
  return {
    create: () => {
      throw new Error("not implemented")
    },
    findById: () => undefined,
    listByRunId: () => [],
    listCreatedInWindow: () => [],
    listCreatedInWindowWithTeam: () => [],
    countPriorByKindForTeam: () => 0,
    ...overrides,
  }
}

test("a team's first-ever kind of flag ranks above a team with far more flags of a kind it always sees", () => {
  // Team Alpha has seen fifty of this kind before, and its flag today is the more recent one --
  // if ranking fell back to raw count or recency, it would win.
  const alphaFlag = makeFlag({
    id: 100,
    teamId: 1,
    teamName: "Alpha",
    kind: "unsafe_command",
    createdAt: "2026-08-10T09:00:00Z",
  })
  // Team Beta has never seen this kind before, and its flag is the older of the two.
  const betaFlag = makeFlag({
    id: 200,
    teamId: 2,
    teamName: "Beta",
    kind: "secret_exposed",
    createdAt: "2026-08-10T08:00:00Z",
  })

  const repo = fakeFlagRepo({
    listCreatedInWindowWithTeam: () => [alphaFlag, betaFlag],
    countPriorByKindForTeam: (teamId, kind) => (teamId === 1 && kind === "unsafe_command" ? 50 : 0),
  })
  const service = new RulesService(repo)

  const page = service.listRanked({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-11T00:00:00Z",
    limit: 50,
    offset: 0,
  })

  expect(page.items.map((f) => f.id)).toEqual([200, 100])
  expect(page.items[0]!.isNewKindForScope).toBe(true)
  expect(page.items[1]!.isNewKindForScope).toBe(false)
})

test("dismissed-as-expected rate is tracked per kind, not just pooled into one number", () => {
  const flags = [
    ...Array.from({ length: 18 }, () => makeFlag({ kind: "unsafe_command", disposition: "expected_and_dismissed" })),
    ...Array.from({ length: 2 }, () => makeFlag({ kind: "unsafe_command", disposition: "confirmed" })),
  ]
  const repo = fakeFlagRepo({ listCreatedInWindow: () => flags })
  const service = new RulesService(repo)

  const summary = service.getSummary({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

  const unsafeCommand = summary.dismissedExpectedByKind.find((k) => k.kind === "unsafe_command")!
  expect(unsafeCommand).toEqual({ kind: "unsafe_command", triggered: 20, dismissedAsExpected: 18, rate: 0.9 })
  expect(summary.dismissedExpectedRate).toBeCloseTo(18 / 20)

  // A kind that never fired this window still shows up, at zero -- not missing from the chart.
  const neverFired = summary.dismissedExpectedByKind.find((k) => k.kind === "goal_hijacked")!
  expect(neverFired).toEqual({ kind: "goal_hijacked", triggered: 0, dismissedAsExpected: 0, rate: 0 })
})

test("severity keeps its own lane -- one flag of each severity in a batch comes back distinct, none merged", () => {
  const flags = [makeFlag({ severity: "low" }), makeFlag({ severity: "medium" }), makeFlag({ severity: "high" })]
  const repo = fakeFlagRepo({ listCreatedInWindow: () => flags })
  const service = new RulesService(repo)

  const summary = service.getSummary({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

  expect(summary.bySeverity).toEqual([
    { severity: "low", count: 1 },
    { severity: "medium", count: 1 },
    { severity: "high", count: 1 },
  ])
})

test("disposition keeps its own lane the same way severity does", () => {
  const flags = [
    makeFlag({ disposition: "confirmed" }),
    makeFlag({ disposition: "expected_and_dismissed" }),
    makeFlag({ disposition: "under_review" }),
  ]
  const repo = fakeFlagRepo({ listCreatedInWindow: () => flags })
  const service = new RulesService(repo)

  const summary = service.getSummary({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

  expect(summary.byStatus).toEqual([
    { status: "confirmed", count: 1 },
    { status: "expected_and_dismissed", count: 1 },
    { status: "under_review", count: 1 },
  ])
})

test("listRanked filters by severity, status, and kind, and pages the already-ranked result", () => {
  const flags = [
    makeFlag({ id: 1, kind: "unsafe_command", severity: "low", disposition: "confirmed" }),
    makeFlag({ id: 2, kind: "unsafe_command", severity: "high", disposition: "confirmed" }),
    makeFlag({ id: 3, kind: "secret_exposed", severity: "high", disposition: "under_review" }),
  ]
  const repo = fakeFlagRepo({ listCreatedInWindowWithTeam: () => flags })
  const service = new RulesService(repo)

  const highOnly = service.listRanked({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
    limit: 50,
    offset: 0,
    severity: "high",
  })
  expect(highOnly.total).toBe(2)
  expect(highOnly.items.map((f) => f.id).sort()).toEqual([2, 3])

  const firstPage = service.listRanked({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
    limit: 1,
    offset: 0,
  })
  expect(firstPage.total).toBe(3)
  expect(firstPage.items).toHaveLength(1)
})
