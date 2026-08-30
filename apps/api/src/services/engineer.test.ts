import { expect, test } from "bun:test"
import type { Artifact, Run } from "@app/shared"
import type { ArtifactRepository } from "../repositories/artifacts.ts"
import type { FinishedTaskCost, RunFilters, RunRepository, TaskOutcome } from "../repositories/runs.ts"
import type { DateWindow } from "../repositories/types.ts"
import { CostService } from "./cost.ts"
import { EngineerService } from "./engineer.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

function makeRun(overrides: Partial<Run> & { id: number }): Run {
  return {
    orgId: 1,
    teamId: 1,
    engineerId: 3,
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

function matchesEngineer(run: Run, filters?: RunFilters): boolean {
  return filters?.engineerId === undefined || run.engineerId === filters.engineerId
}

function fakeRunRepo(runs: readonly Run[]): RunRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    updateRollups: notImplemented("updateRollups"),
    listChainMembers: notImplemented("listChainMembers"),
    listRunning: notImplemented("listRunning"),
    listDailyCostTotals: notImplemented("listDailyCostTotals"),
    listEndedRuns: (_orgId, _window, filters) => runs.filter((r) => matchesEngineer(r, filters) && r.finishedAt !== null),
    listFinishedTaskCosts: (_orgId, _window, filters): FinishedTaskCost[] => {
      const matched = runs.filter((r) => matchesEngineer(r, filters) && r.finishedAt !== null)
      const byTask = new Map<number, Run[]>()
      for (const r of matched) byTask.set(r.parentRunId ?? r.id, [...(byTask.get(r.parentRunId ?? r.id) ?? []), r])
      return [...byTask.entries()].map(([taskId, members]) => ({
        taskId,
        costCents: members.reduce((s, m) => s + m.totalCostCents, 0),
        attemptCount: members.length,
        everSucceeded: members.some((m) => m.status === "succeeded"),
      }))
    },
    listTaskOutcomesStartedIn: (_orgId, _window, filters): TaskOutcome[] => {
      const matched = runs.filter((r) => matchesEngineer(r, filters))
      const byTask = new Map<number, Run[]>()
      for (const r of matched) byTask.set(r.parentRunId ?? r.id, [...(byTask.get(r.parentRunId ?? r.id) ?? []), r])
      return [...byTask.entries()].map(([taskId, members]) => ({ taskId, runs: members }))
    },
    search: notImplemented("search") as unknown as RunRepository["search"],
    listStartedIn: (_orgId, _window, filters) => runs.filter((r) => matchesEngineer(r, filters)),
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),
  }
}

function fakeArtifactRepo(artifacts: readonly Artifact[]): ArtifactRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listByRunId: notImplemented("listByRunId"),
    listPrimaryKindByRunIds: notImplemented("listPrimaryKindByRunIds"),
    listCreatedInWindow: () => [...artifacts],
    listMergedInWindow: () => artifacts.filter((a) => a.mergedAt !== null),
  }
}

const WINDOW_QUERY = { orgId: 1, engineerId: 3, from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z" }

test("finished tasks and cost per finished task are scoped to this engineer's own chains only", () => {
  const runs = [
    makeRun({ id: 1, engineerId: 3, status: "succeeded", totalCostCents: 100 }),
    makeRun({ id: 2, engineerId: 3, status: "failed", failureCause: "tests_failed", blame: "task", totalCostCents: 900 }),
    makeRun({ id: 3, engineerId: 9, status: "succeeded", totalCostCents: 500 }), // someone else's run
  ]
  const runRepo = fakeRunRepo(runs)
  const service = new EngineerService(runRepo, fakeArtifactRepo([]), new CostService(runRepo, notImplemented("turns") as never))

  const result = service.getOverview(WINDOW_QUERY)
  expect(result.finishedTasks).toBe(1)
  expect(result.costPerFinishedTask.medianCents).toBe(100)
})

test("outputs and merged pull requests only count artifacts from this engineer's own runs", () => {
  const runs = [makeRun({ id: 1, engineerId: 3 }), makeRun({ id: 2, engineerId: 9 })]
  const artifacts: Artifact[] = [
    { id: 1, runId: 1, kind: "pull_request", ref: "#1", createdAt: "2026-08-02T00:00:00Z", mergedAt: "2026-08-03T00:00:00Z", revertedAt: null },
    { id: 2, runId: 2, kind: "pull_request", ref: "#2", createdAt: "2026-08-02T00:00:00Z", mergedAt: "2026-08-03T00:00:00Z", revertedAt: null },
  ]
  const runRepo = fakeRunRepo(runs)
  const service = new EngineerService(runRepo, fakeArtifactRepo(artifacts), new CostService(runRepo, notImplemented("turns") as never))

  const result = service.getOverview(WINDOW_QUERY)
  expect(result.mergedPullRequests).toBe(1)
  expect(result.outputs.find((o) => o.kind === "pull_request")!.count).toBe(1)
})

test("quiet failures counts only this engineer's own ended runs flagged as one", () => {
  const runs = [
    makeRun({ id: 1, engineerId: 3, status: "succeeded", isQuietFailure: true }),
    makeRun({ id: 2, engineerId: 3, status: "succeeded", isQuietFailure: false }),
  ]
  const runRepo = fakeRunRepo(runs)
  const service = new EngineerService(runRepo, fakeArtifactRepo([]), new CostService(runRepo, notImplemented("turns") as never))
  expect(service.getOverview(WINDOW_QUERY).quietFailures).toBe(1)
})

test("depth of use buckets this engineer alone -- 20+ runs in the window lands in deep", () => {
  const runs = Array.from({ length: 20 }, (_, i) => makeRun({ id: i + 1, engineerId: 3, startedAt: `2026-08-0${(i % 7) + 1}T0${i % 9}:00:00Z` }))
  const runRepo = fakeRunRepo(runs)
  const service = new EngineerService(runRepo, fakeArtifactRepo([]), new CostService(runRepo, notImplemented("turns") as never))
  expect(service.getOverview(WINDOW_QUERY).depthOfUse).toBe("deep")
})

test("depth of use is dormant when this engineer has no runs at all in the window", () => {
  const runRepo = fakeRunRepo([])
  const service = new EngineerService(runRepo, fakeArtifactRepo([]), new CostService(runRepo, notImplemented("turns") as never))
  expect(service.getOverview(WINDOW_QUERY).depthOfUse).toBe("dormant")
})
