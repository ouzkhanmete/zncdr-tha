import { expect, test } from "bun:test"
import type { Run } from "@app/shared"
import type { FinishedTaskCost, RunFilters, RunRepository, RunSearchResult, TaskOutcome } from "../repositories/runs.ts"
import type { DateWindow } from "../repositories/types.ts"
import { TrendService } from "./trend.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

function inWindow(iso: string, window: DateWindow): boolean {
  return iso >= window.from && iso < window.to
}

/** A fake windowed over one in-memory list of runs, close enough to the real repository's own
 *  "from inclusive, to exclusive" rule for `TrendService` to bucket against, with no filters
 *  applied -- this test only exercises period bucketing, not scoping. */
function fakeRunRepo(runs: readonly Run[]): RunRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    updateRollups: notImplemented("updateRollups"),
    listChainMembers: notImplemented("listChainMembers"),
    listRunning: notImplemented("listRunning"),
    listDailyCostTotals: notImplemented("listDailyCostTotals"),
    listStartedIn: notImplemented("listStartedIn"),
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),

    search: (_orgId: number, window: DateWindow, _filters: RunFilters & { limit: number; offset: number }): RunSearchResult => {
      const items = runs.filter((r) => inWindow(r.startedAt, window))
      return { items, total: items.length }
    },

    listEndedRuns: (_orgId: number, window: DateWindow): Run[] =>
      runs.filter((r) => r.finishedAt !== null && inWindow(r.finishedAt, window)),

    listFinishedTaskCosts: (_orgId: number, window: DateWindow): FinishedTaskCost[] => {
      const finished = runs.filter((r) => r.finishedAt !== null && inWindow(r.finishedAt, window))
      const byTask = new Map<number, Run[]>()
      for (const r of finished) {
        const taskId = r.parentRunId ?? r.id
        byTask.set(taskId, [...(byTask.get(taskId) ?? []), r])
      }
      return [...byTask.entries()].map(([taskId, members]) => ({
        taskId,
        costCents: members.reduce((sum, m) => sum + m.totalCostCents, 0),
        attemptCount: members.length,
        everSucceeded: members.some((m) => m.status === "succeeded"),
      }))
    },

    listTaskOutcomesStartedIn: notImplemented("listTaskOutcomesStartedIn") as unknown as (
      orgId: number,
      window: DateWindow,
      filters?: RunFilters,
    ) => TaskOutcome[],
  }
}

function makeRun(overrides: Partial<Run> & { id: number }): Run {
  return {
    orgId: 1,
    teamId: 1,
    engineerId: null,
    parentRunId: null,
    agentKind: "code-fix",
    trigger: "person",
    repo: null,
    branch: null,
    startedAt: "2026-08-01T09:00:00Z",
    actorUtcOffsetMinutes: 0,
    finishedAt: "2026-08-01T09:05:00Z",
    status: "succeeded",
    failureCause: null,
    blame: null,
    isQuietFailure: false,
    durationMs: 300_000,
    totalCostCents: 100,
    turnCount: 1,
    toolCallCount: 0,
    taskSummary: "x",
    ...overrides,
  }
}

test("one point per day, each scoped to only that day's own runs", () => {
  const runs = [
    makeRun({ id: 1, startedAt: "2026-08-01T09:00:00Z", finishedAt: "2026-08-01T09:05:00Z", status: "succeeded", totalCostCents: 100 }),
    makeRun({ id: 2, startedAt: "2026-08-01T10:00:00Z", finishedAt: "2026-08-01T10:05:00Z", status: "failed", totalCostCents: 200, failureCause: "tests_failed", blame: "task" }),
    makeRun({ id: 3, startedAt: "2026-08-02T09:00:00Z", finishedAt: "2026-08-02T09:05:00Z", status: "succeeded", totalCostCents: 300 }),
  ]
  const trend = new TrendService(fakeRunRepo(runs))
  const result = trend.getTrend({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-03T00:00:00Z", interval: "day" })

  expect(result.points).toHaveLength(2)

  const [day1, day2] = result.points
  expect(day1!.periodStart).toBe("2026-08-01T00:00:00.000Z")
  expect(day1!.runsStarted).toBe(2)
  expect(day1!.finishedTasks).toBe(1) // only the succeeded chain
  expect(day1!.medianCostPerFinishedTaskCents).toBe(100)
  expect(day1!.successRateFirstTry).toBe(0.5) // 1 success of 2 ended runs, neither cancelled early

  expect(day2!.runsStarted).toBe(1)
  expect(day2!.finishedTasks).toBe(1)
  expect(day2!.successRateFirstTry).toBe(1)
})

test("a run cancelled in its first few seconds is excluded from success rate, not counted as a loss", () => {
  const runs = [
    makeRun({ id: 1, status: "succeeded", totalCostCents: 100 }),
    makeRun({
      id: 2,
      status: "cancelled",
      durationMs: 2_000,
      totalCostCents: 0,
      failureCause: null,
      blame: null,
    }),
  ]
  const trend = new TrendService(fakeRunRepo(runs))
  const result = trend.getTrend({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z", interval: "day" })
  // Cancelled-early is pulled out of both top and bottom -- 1 success of 1 scored run, not 1 of 2.
  expect(result.points[0]!.successRateFirstTry).toBe(1)
})

test("a period with nothing finished reports a null median, not zero", () => {
  const runs = [makeRun({ id: 1, status: "running", finishedAt: null, durationMs: null })]
  const trend = new TrendService(fakeRunRepo(runs))
  const result = trend.getTrend({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z", interval: "day" })
  expect(result.points[0]!.finishedTasks).toBe(0)
  expect(result.points[0]!.medianCostPerFinishedTaskCents).toBeNull()
})

test("a range shorter than one interval still yields exactly one, clipped period", () => {
  const trend = new TrendService(fakeRunRepo([]))
  const result = trend.getTrend({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-01T12:00:00Z", interval: "day" })
  expect(result.points).toHaveLength(1)
  expect(result.points[0]!.periodEnd).toBe("2026-08-01T12:00:00.000Z")
})
