import { expect, test } from "bun:test"
import type { Run, Turn } from "@app/shared"
import type { TurnRepository } from "../repositories/turns.ts"
import { SpeedService } from "./speed.ts"
import { makeFakeRunRepository } from "./test-helpers.ts"

let nextRunId = 1
let nextTurnId = 1

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: nextRunId++,
    orgId: 1,
    teamId: 1,
    engineerId: null,
    parentRunId: null,
    agentKind: "coder",
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
    totalCostCents: 0,
    turnCount: 0,
    toolCallCount: 0,
    taskSummary: "test run",
    ...overrides,
  }
}

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: nextTurnId++,
    runId: 1,
    turnIndex: 0,
    modelId: 1,
    tokensInFresh: 0,
    tokensInCached: 0,
    tokensCacheWrite: 0,
    tokensOut: 0,
    tokensThinking: 0,
    latencyMs: 100,
    finishReason: "stop",
    costCents: 0,
    startedAt: "2026-08-01T09:00:00Z",
    ...overrides,
  }
}

const fakeRunRepo = makeFakeRunRepository

function fakeTurnRepo(overrides: Partial<TurnRepository> = {}): TurnRepository {
  return {
    create: () => {
      throw new Error("not implemented")
    },
    findById: () => undefined,
    listByRunId: () => [],
    listStartedInWindow: () => [],
    ...overrides,
  }
}

test("turn time and run time are two different measurements, computed and reported apart", () => {
  // One slow run made of forty quick turns -- turn-time p95 should read low, run-time p95 high.
  const turns = Array.from({ length: 40 }, () => makeTurn({ latencyMs: 100 }))
  const run = makeRun({ status: "succeeded", durationMs: 40 * 60 * 1000 })

  const service = new SpeedService(
    fakeRunRepo({ listEndedRuns: () => [run] }),
    fakeTurnRepo({ listStartedInWindow: () => turns }),
  )

  const result = service.getSpeed({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

  expect(result.turnTime.p95Ms).toBe(100)
  expect(result.runTime.p95Ms).toBe(40 * 60 * 1000)
  expect(result.runTime.p95Ms!).toBeGreaterThan(result.turnTime.p95Ms!)
})

test("percentiles are computed once over every raw turn in the window, never averaged per day", () => {
  // Day one: 10 turns at 100ms, own p95 ~100ms. Day two: 9 turns at 100ms, one at 2000ms, own p95
  // ~2000ms. Averaging those two daily p95s gives ~1050ms -- the exact trap docs/metrics.md
  // warns about. Over all 20 raw turns together, 19 of 20 are 100ms, so the true p95 is 100ms.
  const day1 = Array.from({ length: 10 }, () => makeTurn({ latencyMs: 100 }))
  const day2 = [...Array.from({ length: 9 }, () => makeTurn({ latencyMs: 100 })), makeTurn({ latencyMs: 2000 })]

  const service = new SpeedService(
    fakeRunRepo(),
    fakeTurnRepo({ listStartedInWindow: () => [...day1, ...day2] }),
  )

  const result = service.getSpeed({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-03T00:00:00Z" })

  expect(result.turnTime.p95Ms).toBe(100)
  expect(result.turnTime.p95Ms).not.toBeCloseTo(1050, 0)
})

test("timed-out runs are counted apart and never blended into run-time percentiles", () => {
  const normalRuns = [
    makeRun({ status: "succeeded", durationMs: 5 * 60 * 1000 }),
    makeRun({ status: "succeeded", durationMs: 6 * 60 * 1000 }),
    makeRun({ status: "failed", failureCause: "tests_failed", blame: "task", durationMs: 7 * 60 * 1000 }),
  ]
  const timedOutRuns = [
    makeRun({
      status: "timed_out",
      failureCause: "hit_token_or_time_limit",
      blame: "org_setup",
      durationMs: 30 * 1000, // capped at the timeout limit, not a real "fast" run
    }),
    makeRun({
      status: "timed_out",
      failureCause: "hit_token_or_time_limit",
      blame: "org_setup",
      durationMs: 30 * 1000,
    }),
  ]

  const service = new SpeedService(
    fakeRunRepo({ listEndedRuns: () => [...normalRuns, ...timedOutRuns] }),
    fakeTurnRepo(),
  )

  const result = service.getSpeed({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

  expect(result.timedOutRuns).toBe(2)
  // p50/p95 computed over only the three normal runs -- the two capped runs never enter the pool.
  expect(result.runTime.p50Ms).toBe(6 * 60 * 1000)
  expect(result.runTime.p95Ms).toBe(7 * 60 * 1000)

  // Prove blending really would be the misleading move: folding the capped runs in drags the
  // fastest value in the whole set down to the timeout limit, which would read as "got faster."
  const wronglyBlended = [...normalRuns, ...timedOutRuns].map((r) => r.durationMs!)
  expect(Math.min(...wronglyBlended)).toBeLessThan(result.runTime.p50Ms!)
})

test("run time leaves out cancelled runs too, matching the reference SQL in docs/data-model.md", () => {
  const runs = [
    makeRun({ status: "succeeded", durationMs: 5 * 60 * 1000 }),
    makeRun({ status: "cancelled", durationMs: 1000 }), // walked away from, never really timed
  ]
  const service = new SpeedService(fakeRunRepo({ listEndedRuns: () => runs }), fakeTurnRepo())

  const result = service.getSpeed({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })
  expect(result.runTime.p50Ms).toBe(5 * 60 * 1000)
})

test("no turns or runs in the window means no percentile, not zero or NaN", () => {
  const service = new SpeedService(fakeRunRepo(), fakeTurnRepo())
  const result = service.getSpeed({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

  expect(result.turnTime).toEqual({ p50Ms: null, p95Ms: null, p99Ms: null })
  expect(result.runTime).toEqual({ p50Ms: null, p95Ms: null, p99Ms: null })
  expect(result.timedOutRuns).toBe(0)
})
