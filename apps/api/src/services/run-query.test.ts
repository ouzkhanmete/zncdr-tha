import { expect, test } from "bun:test"
import type { Artifact, PolicyFlag, Run, ToolCall, Turn } from "@app/shared"
import type { ArtifactRepository } from "../repositories/artifacts.ts"
import type { ModelRepository } from "../repositories/models.ts"
import type { PolicyFlagRepository } from "../repositories/policy-flags.ts"
import type { RunFilters, RunRepository, RunSearchResult } from "../repositories/runs.ts"
import type { ToolCallRepository } from "../repositories/tool-calls.ts"
import type { DateWindow } from "../repositories/types.ts"
import type { TurnRepository } from "../repositories/turns.ts"
import { RunQueryService } from "./run-query.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
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

function fakeRunRepo(byId: Map<number, Run>, chains: Map<number, Run[]>): RunRepository {
  return {
    create: notImplemented("create"),
    updateRollups: notImplemented("updateRollups"),
    listEndedRuns: notImplemented("listEndedRuns"),
    listFinishedTaskCosts: notImplemented("listFinishedTaskCosts"),
    listTaskOutcomesStartedIn: notImplemented("listTaskOutcomesStartedIn"),
    listRunning: notImplemented("listRunning"),
    listDailyCostTotals: notImplemented("listDailyCostTotals"),
    listStartedIn: notImplemented("listStartedIn"),
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),
    findById: (id) => byId.get(id),
    listChainMembers: (taskId) => chains.get(taskId) ?? [],
    search: (_orgId: number, _window: DateWindow, filters: RunFilters & { limit: number; offset: number }): RunSearchResult => {
      const items = [...byId.values()].filter((r) => filters.engineerId === undefined || r.engineerId === filters.engineerId)
      return { items, total: items.length }
    },
  }
}

function fakeArtifactRepo(primaryKindByRunId: Map<number, "pull_request" | "commit" | "file" | "report">, byRunId: Map<number, Artifact[]>): ArtifactRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listCreatedInWindow: notImplemented("listCreatedInWindow"),
    listMergedInWindow: notImplemented("listMergedInWindow"),
    listByRunId: (runId) => byRunId.get(runId) ?? [],
    listPrimaryKindByRunIds: (runIds) => {
      const map = new Map<number, "pull_request" | "commit" | "file" | "report">()
      for (const id of runIds) {
        const kind = primaryKindByRunId.get(id)
        if (kind) map.set(id, kind)
      }
      return map
    },
  }
}

function emptyRepos() {
  const turns: TurnRepository = {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listStartedInWindow: notImplemented("listStartedInWindow"),
    listByRunId: (): Turn[] => [],
  }
  const toolCalls: ToolCallRepository = {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listByTurnId: notImplemented("listByTurnId"),
    listByRunId: (): ToolCall[] => [],
  }
  const policyFlags: PolicyFlagRepository = {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listCreatedInWindow: notImplemented("listCreatedInWindow"),
    listCreatedInWindowWithTeam: notImplemented("listCreatedInWindowWithTeam"),
    countPriorByKindForTeam: notImplemented("countPriorByKindForTeam"),
    listByRunId: (): PolicyFlag[] => [],
  }
  const models: ModelRepository = {
    create: notImplemented("create"),
    findEffectiveAt: notImplemented("findEffectiveAt"),
    listAll: notImplemented("listAll"),
    findById: () => undefined,
  }
  return { turns, toolCalls, policyFlags, models }
}

test("search attaches each run's primary output kind without a per-row round trip", () => {
  const runA = makeRun({ id: 1 })
  const runB = makeRun({ id: 2 })
  const runs = fakeRunRepo(new Map([[1, runA], [2, runB]]), new Map())
  const artifacts = fakeArtifactRepo(new Map([[1, "pull_request"]]), new Map())
  const { turns, toolCalls, policyFlags, models } = emptyRepos()
  const service = new RunQueryService(runs, artifacts, turns, toolCalls, policyFlags, models)

  const result = service.search({ orgId: 1, window: { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }, limit: 50, offset: 0 })

  expect(result.total).toBe(2)
  expect(result.items.find((r) => r.id === 1)!.primaryOutputKind).toBe("pull_request")
  expect(result.items.find((r) => r.id === 2)!.primaryOutputKind).toBeNull()
})

test("getDetail returns undefined for an id that matches nothing, for the controller to turn into a 404", () => {
  const runs = fakeRunRepo(new Map(), new Map())
  const artifacts = fakeArtifactRepo(new Map(), new Map())
  const { turns, toolCalls, policyFlags, models } = emptyRepos()
  const service = new RunQueryService(runs, artifacts, turns, toolCalls, policyFlags, models)
  expect(service.getDetail(999)).toBeUndefined()
})

test("getDetail's task attempts are the whole chain, first attempt first, with isSelf marking the one that was asked for", () => {
  const attempt1 = makeRun({ id: 1, parentRunId: null, status: "failed", failureCause: "tests_failed", blame: "task" })
  const attempt2 = makeRun({ id: 2, parentRunId: 1, status: "succeeded" })
  const runs = fakeRunRepo(new Map([[1, attempt1], [2, attempt2]]), new Map([[1, [attempt1, attempt2]]]))
  const artifacts = fakeArtifactRepo(new Map(), new Map())
  const { turns, toolCalls, policyFlags, models } = emptyRepos()
  const service = new RunQueryService(runs, artifacts, turns, toolCalls, policyFlags, models)

  const detail = service.getDetail(2)!
  expect(detail.run.id).toBe(2)
  expect(detail.taskAttempts).toEqual([
    { runId: 1, attemptNumber: 1, status: "failed", startedAt: attempt1.startedAt, totalCostCents: 100, isSelf: false, failureCause: "tests_failed", blame: "task" },
    { runId: 2, attemptNumber: 2, status: "succeeded", startedAt: attempt2.startedAt, totalCostCents: 100, isSelf: true, failureCause: null, blame: null },
  ])
})
