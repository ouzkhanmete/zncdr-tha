import { expect, test } from "bun:test"
import type { Run } from "@app/shared"
import type { TaskOutcome } from "../repositories/runs.ts"
import { FAILURE_CAUSE_BLAME, ReliabilityService } from "./reliability.ts"
import { makeFakeRunRepository } from "./test-helpers.ts"

let nextRunId = 1

/** A finished, successful run with sane defaults -- pass only what a given test cares about. */
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

const fakeRunRepo = makeFakeRunRepository

test("every failure cause in docs/metrics.md Group 4 maps to exactly one blame bucket, none missing, none doubled", () => {
  const expected: Record<string, "org_setup" | "platform" | "task"> = {
    missing_permission: "org_setup",
    missing_secret_or_login: "org_setup",
    tool_not_available: "org_setup",
    network_or_sandbox_blocked: "org_setup",
    hit_token_or_time_limit: "org_setup",
    dependency_install_failed: "task",
    ran_out_of_context: "platform",
    infrastructure_crash: "platform",
    rate_limited: "platform",
    model_refused: "task",
    tests_failed: "task",
    nothing_useful_produced: "task",
  }
  expect(FAILURE_CAUSE_BLAME).toEqual(expected)
  expect(Object.keys(FAILURE_CAUSE_BLAME)).toHaveLength(12)
  expect(new Set(Object.values(FAILURE_CAUSE_BLAME))).toEqual(new Set(["org_setup", "platform", "task"]))
})

test("failure rate splits by cause and by blame, and a cancelled run is left out of both halves and counted apart", () => {
  const runs = [
    makeRun({ status: "failed", failureCause: "missing_permission", blame: "org_setup" }),
    makeRun({ status: "failed", failureCause: "tool_not_available", blame: "org_setup" }),
    makeRun({ status: "timed_out", failureCause: "hit_token_or_time_limit", blame: "org_setup" }),
    makeRun({ status: "failed", failureCause: "rate_limited", blame: "platform" }),
    makeRun({ status: "failed", failureCause: "tests_failed", blame: "task" }),
    makeRun({ status: "succeeded" }),
    makeRun({ status: "cancelled" }), // no cause, no blame -- a person changed their mind
  ]
  const repo = fakeRunRepo({ listEndedRuns: () => runs })
  const service = new ReliabilityService(repo)

  const result = service.getReliability({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-08T00:00:00Z",
  })
  const window = result.failureRate.last7d

  expect(window.cancelled).toBe(1)
  // 7 ended runs minus the 1 cancelled -- the bottom of both halves of the failure rate.
  expect(window.endedRuns).toBe(6)

  const byBlame = Object.fromEntries(window.byBlame.map((b) => [b.blame, b]))
  expect(byBlame.org_setup).toEqual({ blame: "org_setup", count: 3, rate: 3 / 6 })
  expect(byBlame.platform).toEqual({ blame: "platform", count: 1, rate: 1 / 6 })
  expect(byBlame.task).toEqual({ blame: "task", count: 1, rate: 1 / 6 })

  // byCause and byBlame must never disagree -- every failure counted once shows up exactly once
  // in each split.
  const totalByCause = window.byCause.reduce((sum, c) => sum + c.count, 0)
  const totalByBlame = window.byBlame.reduce((sum, b) => sum + b.count, 0)
  expect(totalByCause).toBe(5)
  expect(totalByBlame).toBe(5)

  // Every one of the twelve causes is present, even the ones that didn't fire this window --
  // a cause silently missing from the mapping would drop runs off this chart without a trace.
  expect(window.byCause).toHaveLength(12)
  const missingPermission = window.byCause.find((c) => c.cause === "missing_permission")!
  expect(missingPermission).toEqual({ cause: "missing_permission", count: 1, rate: 1 / 6 })
  const neverFired = window.byCause.find((c) => c.cause === "network_or_sandbox_blocked")!
  expect(neverFired).toEqual({ cause: "network_or_sandbox_blocked", count: 0, rate: 0 })
})

test("a quiet failure is counted on its own, and never shows up in the failure-by-cause split", () => {
  const runs = [
    makeRun({ status: "succeeded", isQuietFailure: true }),
    makeRun({ status: "succeeded", isQuietFailure: false }),
    makeRun({ status: "failed", failureCause: "tests_failed", blame: "task" }),
  ]
  const repo = fakeRunRepo({ listEndedRuns: () => runs })
  const service = new ReliabilityService(repo)

  const result = service.getReliability({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
  })

  expect(result.quietFailures.count).toBe(1)
  expect(result.quietFailures.rate).toBeCloseTo(1 / 3)

  // A quiet failure has no failure cause of its own -- reported succeeded, so it carries none.
  const testsFailed = result.failureRate.last7d.byCause.find((c) => c.cause === "tests_failed")!
  expect(testsFailed.count).toBe(1)
})

test("retry rate counts retried tasks, not retried runs", () => {
  const outcomes: TaskOutcome[] = [
    { taskId: 1, runs: [makeRun({ status: "succeeded" })] },
    {
      taskId: 2,
      runs: [
        makeRun({ status: "failed", failureCause: "tests_failed", blame: "task" }),
        makeRun({ status: "succeeded" }),
      ],
    },
    {
      taskId: 3,
      runs: [
        makeRun({ status: "failed", failureCause: "tests_failed", blame: "task" }),
        makeRun({ status: "failed", failureCause: "tests_failed", blame: "task" }),
        makeRun({ status: "succeeded" }),
      ],
    },
    {
      taskId: 4,
      runs: [
        makeRun({ status: "failed", failureCause: "tests_failed", blame: "task" }),
        makeRun({ status: "succeeded" }),
      ],
    },
  ]
  const repo = fakeRunRepo({ listTaskOutcomesStartedIn: () => outcomes })
  const service = new ReliabilityService(repo)

  const result = service.getReliability({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
  })
  expect(result.retryRate).toEqual({ tasksNeedingRetry: 3, totalTasks: 4, rate: 3 / 4 })
})

test("time before giving up counts only the duration of runs that failed, not a success sitting right next to it", () => {
  const runs = [
    makeRun({
      status: "failed",
      failureCause: "tests_failed",
      blame: "task",
      durationMs: 45 * 60 * 1000,
    }),
    makeRun({ status: "succeeded", durationMs: 2 * 60 * 1000 }),
    // A run still in progress has no finished_at, so the real repository would never hand it
    // back from listEndedRuns in the first place -- nothing to filter here on purpose.
  ]
  const repo = fakeRunRepo({ listEndedRuns: () => runs })
  const service = new ReliabilityService(repo)

  const result = service.getReliability({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
  })
  expect(result.timeBeforeGivingUp).toEqual({ p50Ms: 45 * 60 * 1000, p95Ms: 45 * 60 * 1000 })
})

test("retry rate and time before giving up come out as 0 and null, not NaN, when nothing happened in the window", () => {
  const repo = fakeRunRepo()
  const service = new ReliabilityService(repo)

  const result = service.getReliability({
    orgId: 1,
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
  })
  expect(result.retryRate).toEqual({ tasksNeedingRetry: 0, totalTasks: 0, rate: 0 })
  expect(result.timeBeforeGivingUp).toEqual({ p50Ms: null, p95Ms: null })
  expect(result.quietFailures).toEqual({ count: 0, rate: 0 })
})
