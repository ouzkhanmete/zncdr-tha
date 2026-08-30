import { expect, test } from "bun:test"
import type { Artifact, Run } from "@app/shared"
import type { ArtifactRepository } from "../repositories/artifacts.ts"
import type { FinishedTaskCost, RunRepository, TaskOutcome } from "../repositories/runs.ts"
import { OutcomeService } from "./outcome.ts"

const WINDOW = { from: "2026-08-01T00:00:00Z", to: "2026-08-31T00:00:00Z" }

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

let nextId = 1
function run(overrides: Partial<Run> & { status: Run["status"] }): Run {
  return {
    id: nextId++,
    orgId: 1,
    teamId: 1,
    engineerId: 1,
    parentRunId: null,
    agentKind: "coder",
    trigger: "person",
    repo: null,
    branch: null,
    startedAt: "2026-08-10T09:00:00Z",
    actorUtcOffsetMinutes: 0,
    finishedAt: "2026-08-10T09:05:00Z",
    failureCause: null,
    blame: null,
    isQuietFailure: false,
    durationMs: 300_000,
    totalCostCents: 0,
    turnCount: 0,
    toolCallCount: 0,
    taskSummary: "",
    ...overrides,
  }
}

/** Builds a fake `RunRepository` from exactly the three shapes outcome.ts asks of it: the
 *  already-collapsed finished-task costs, the ended runs for a window, and the task outcomes
 *  anchored on when each chain started. Each parameter is a function of the window it's asked
 *  for, so a test can hand back a different answer for the 7-day and 30-day calls when it needs
 *  to, or ignore the window entirely and always return the same fixed rows when it doesn't. */
function fakeRunRepo(opts: {
  finishedTaskCosts?: FinishedTaskCost[]
  endedRuns?: Run[] | ((window: { from: string; to: string }) => Run[])
  taskOutcomes?: TaskOutcome[] | ((window: { from: string; to: string }) => TaskOutcome[])
  running?: Run[]
}): RunRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    updateRollups: notImplemented("updateRollups"),
    listChainMembers: notImplemented("listChainMembers"),
    search: notImplemented("search"),
    listStartedIn: notImplemented("listStartedIn"),
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),
    listDailyCostTotals: notImplemented("listDailyCostTotals"),
    listFinishedTaskCosts: () => opts.finishedTaskCosts ?? [],
    listEndedRuns: (_orgId, window) =>
      typeof opts.endedRuns === "function" ? opts.endedRuns(window) : (opts.endedRuns ?? []),
    listTaskOutcomesStartedIn: (_orgId, window) =>
      typeof opts.taskOutcomes === "function" ? opts.taskOutcomes(window) : (opts.taskOutcomes ?? []),
    listRunning: () => opts.running ?? [],
  }
}

function artifact(overrides: Partial<Artifact> & { kind: Artifact["kind"] }): Artifact {
  return {
    id: nextId++,
    runId: 1,
    ref: "ref",
    createdAt: "2026-08-10T00:00:00Z",
    mergedAt: null,
    revertedAt: null,
    ...overrides,
  }
}

/** Backs the two different questions outcome.ts now asks the artifact repository with two
 *  independent lists, since they're genuinely different queries -- "what came out" is created-in
 *  window, "merged pull requests" and rework rate are merged-in-window, and a real org can have
 *  artifacts in one without being in the other (see artifacts.test.ts for the SQL-level proof
 *  that a pull request created before a window but merged inside it lands in the second list, not
 *  the first). */
function fakeArtifactRepo(opts: { createdInWindow?: Artifact[]; mergedInWindow?: Artifact[] }): ArtifactRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listByRunId: notImplemented("listByRunId"),
    listPrimaryKindByRunIds: notImplemented("listPrimaryKindByRunIds"),
    listCreatedInWindow: () => opts.createdInWindow ?? [],
    listMergedInWindow: () => opts.mergedInWindow ?? [],
  }
}

test("first-try and eventual success rate answer different questions from the same rows", () => {
  // 5 tasks: 3 succeed first try. 2 fail once, then succeed on a retry -- 7 runs total.
  const endedRuns = [
    run({ status: "succeeded" }),
    run({ status: "succeeded" }),
    run({ status: "succeeded" }),
    run({ status: "failed", failureCause: "tests_failed", blame: "task" }),
    run({ status: "succeeded" }),
    run({ status: "failed", failureCause: "tests_failed", blame: "task" }),
    run({ status: "succeeded" }),
  ]
  const taskOutcomes: TaskOutcome[] = [
    { taskId: 1, runs: [endedRuns[0]!] },
    { taskId: 2, runs: [endedRuns[1]!] },
    { taskId: 3, runs: [endedRuns[2]!] },
    { taskId: 4, runs: [endedRuns[3]!, endedRuns[4]!] },
    { taskId: 5, runs: [endedRuns[5]!, endedRuns[6]!] },
  ]
  const service = new OutcomeService(
    fakeRunRepo({ endedRuns, taskOutcomes }),
    fakeArtifactRepo({}),
  )

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  // 5 successful runs over 7 runs that reached an end.
  expect(result.successRate.last30d.firstTry).toEqual({ successes: 5, endedRuns: 7, rate: 5 / 7 })
  // Every one of the 5 tasks eventually won.
  expect(result.successRate.last30d.eventual).toEqual({ succeededTasks: 5, totalTasks: 5, rate: 1 })
})

test("finished tasks collapses a retry chain to one task, not three", () => {
  // One task, three attempts: two failures then a success. Money's job is the cost; this only
  // proves the chain counts once.
  const finishedTaskCosts: FinishedTaskCost[] = [
    { taskId: 1, costCents: 600, attemptCount: 3, everSucceeded: true },
  ]
  const service = new OutcomeService(fakeRunRepo({ finishedTaskCosts }), fakeArtifactRepo({}))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.finishedTasks).toBe(1)
})

test("a task chain that never succeeded contributes nothing to finished tasks", () => {
  const finishedTaskCosts: FinishedTaskCost[] = [
    { taskId: 1, costCents: 600, attemptCount: 1, everSucceeded: true },
    { taskId: 2, costCents: 400, attemptCount: 2, everSucceeded: false },
  ]
  const service = new OutcomeService(fakeRunRepo({ finishedTaskCosts }), fakeArtifactRepo({}))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.finishedTasks).toBe(1)
})

test("a run cancelled in its first few seconds is neither a win nor a loss, but isn't lost either", () => {
  const cancelledEarly = run({ status: "cancelled", durationMs: 3_000 })
  const succeeded = run({ status: "succeeded" })
  const endedRuns = [cancelledEarly, succeeded]
  const taskOutcomes: TaskOutcome[] = [
    { taskId: cancelledEarly.id, runs: [cancelledEarly] },
    { taskId: succeeded.id, runs: [succeeded] },
  ]
  const service = new OutcomeService(fakeRunRepo({ endedRuns, taskOutcomes }), fakeArtifactRepo({}))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  // Not counted as a loss (endedRuns and successes both exclude it) --
  expect(result.successRate.last30d.firstTry).toEqual({ successes: 1, endedRuns: 1, rate: 1 })
  // -- and the task made entirely of a cancelled-early run vanishes from eventual's totals too.
  expect(result.successRate.last30d.eventual).toEqual({ succeededTasks: 1, totalTasks: 1, rate: 1 })
  // But it isn't just dropped -- it shows up in its own count.
  expect(result.successRate.last30d.cancelledEarly).toBe(1)
})

test("a run cancelled well after it started is a real loss, not a cancelled-early one", () => {
  const cancelledLate = run({ status: "cancelled", durationMs: 60_000 })
  const service = new OutcomeService(fakeRunRepo({ endedRuns: [cancelledLate] }), fakeArtifactRepo({}))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.successRate.last30d.firstTry).toEqual({ successes: 0, endedRuns: 1, rate: 0 })
  expect(result.successRate.last30d.cancelledEarly).toBe(0)
})

test("success rate is 0, not NaN, when nothing ended in the window", () => {
  const service = new OutcomeService(fakeRunRepo({}), fakeArtifactRepo({}))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.successRate.last30d.firstTry.rate).toBe(0)
  expect(result.successRate.last30d.eventual.rate).toBe(0)
})

test("what came out counts every kind, and the honest number is merged pull requests, not opened ones", () => {
  const artifacts = [
    artifact({ kind: "pull_request", mergedAt: "2026-08-11T00:00:00Z" }),
    artifact({ kind: "pull_request", mergedAt: "2026-08-12T00:00:00Z" }),
    artifact({ kind: "pull_request", mergedAt: "2026-08-13T00:00:00Z" }),
    artifact({ kind: "pull_request", mergedAt: null }), // still open
    artifact({ kind: "pull_request", mergedAt: null }), // still open
    artifact({ kind: "commit" }),
  ]
  // All 6 were also created in this window, and the 3 merged ones merged inside it too -- a
  // real `listMergedInWindow` call would hand back exactly that merged subset.
  const service = new OutcomeService(
    fakeRunRepo({}),
    fakeArtifactRepo({ createdInWindow: artifacts, mergedInWindow: artifacts.filter((a) => a.mergedAt !== null) }),
  )

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  // Every kind always present, zero-filled -- a chart shouldn't have to guess whether an absent
  // kind means zero or means the number never loaded.
  expect(result.outputs).toEqual([
    { kind: "pull_request", count: 5 },
    { kind: "commit", count: 1 },
    { kind: "file", count: 0 },
    { kind: "report", count: 0 },
  ])
  // 5 pull requests produced, only 3 actually merged.
  expect(result.mergedPullRequests).toBe(3)
})

test("rework rate only counts a revert or rewrite inside the 14-day window", () => {
  const artifacts = [
    artifact({ kind: "pull_request", mergedAt: "2026-08-01T00:00:00Z", revertedAt: "2026-08-11T00:00:00Z" }), // day 10, inside
    artifact({ kind: "pull_request", mergedAt: "2026-08-01T00:00:00Z", revertedAt: "2026-08-21T00:00:00Z" }), // day 20, outside
    artifact({ kind: "pull_request", mergedAt: "2026-08-01T00:00:00Z" }), // never touched
  ]
  const service = new OutcomeService(fakeRunRepo({}), fakeArtifactRepo({ mergedInWindow: artifacts }))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.reworkRate).toEqual({ revertedOrRewritten: 1, totalMerged: 3, rate: 1 / 3 })
})

test("merged pull requests and rework rate are built from merged-in-window artifacts, never created-in-window ones", () => {
  // Created in this window but never merged -- must count toward "what came out" and nothing
  // else. If the service reused this list for rework rate or the merged-PR count, both would
  // come out wrong.
  const createdNotMerged = artifact({ kind: "pull_request", mergedAt: null })
  // Not present in "created in window" at all -- stands in for a pull request created before the
  // window but merged inside it, which is exactly what `listMergedInWindow` is for (proved at
  // the SQL level in artifacts.test.ts). If the service asked `listCreatedInWindow` for this
  // instead, it would never see it and both numbers below would come out as zero.
  const mergedInWindow = artifact({ kind: "pull_request", mergedAt: "2026-08-05T00:00:00Z" })

  const service = new OutcomeService(
    fakeRunRepo({}),
    fakeArtifactRepo({ createdInWindow: [createdNotMerged], mergedInWindow: [mergedInWindow] }),
  )

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.outputs.find((o) => o.kind === "pull_request")?.count).toBe(1) // the created one
  expect(result.mergedPullRequests).toBe(1) // the merged one, not the created one
  expect(result.reworkRate.totalMerged).toBe(1) // same source as mergedPullRequests
})

test("rework rate is 0, not NaN, when nothing has merged yet", () => {
  const service = new OutcomeService(fakeRunRepo({}), fakeArtifactRepo({}))

  const result = service.getOutcomes({ orgId: 1, ...WINDOW })

  expect(result.reworkRate).toEqual({ revertedOrRewritten: 0, totalMerged: 0, rate: 0 })
})

test("a run still in progress never touches success rate, and is counted live instead", () => {
  const running = [
    run({ status: "succeeded", finishedAt: null, durationMs: null, totalCostCents: 500 }),
    run({ status: "succeeded", finishedAt: null, durationMs: null, totalCostCents: 250 }),
  ]
  // listEndedRuns / listTaskOutcomesStartedIn already only ever return finished runs by
  // contract -- this fake proves the service reads the in-progress count from `listRunning`,
  // not by trying to filter a running run out of the ended-runs list itself.
  const service = new OutcomeService(fakeRunRepo({ running }), fakeArtifactRepo({}))

  const result = service.inProgress(1)

  expect(result).toEqual({ count: 2, costSoFarCents: 750 })
})
