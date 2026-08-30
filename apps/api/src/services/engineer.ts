/**
 * `GET /api/engineers/:id/overview` -- docs/api.md section 6. None of the three engineer calls
 * compare anyone to a teammate (docs/product-brief.md: "an engineer's page compares them only to
 * their own past"), so every repository call here is scoped by `engineerId`, never by team.
 *
 * Most of this reuses the exact same repository calls and formulas `OutcomeService` and
 * `CostService` already use for the org and team screens -- `RunFilters.engineerId` narrows every
 * one of them the same way `teamId` does (see `services/adoption.ts`'s and `services/outcome.ts`'s
 * own repository calls). The one gap: `ArtifactRepository.listCreatedInWindow` /
 * `listMergedInWindow` only narrow by team and agent kind, not by engineer, so "this engineer's
 * own outputs" and "this engineer's own merged pull requests" are worked out here by intersecting
 * the window's artifacts with this engineer's own run ids, rather than adding engineer-scoping to
 * either repository method.
 */

import { artifactKind } from "@app/shared"
import type { ArtifactKind, DepthOfUseBucket } from "@app/shared"
import type { ArtifactRepository } from "../repositories/artifacts.ts"
import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { DateWindow } from "../repositories/types.ts"
import type { CostService, TaskCostStats } from "./cost.ts"
import { isCancelledEarly } from "./trend.ts"

const ALL_ARTIFACT_KINDS = artifactKind.options

/** Every timestamp before/after any real org could have data -- stands in for "always", so
 *  finding every run this engineer has ever started can reuse `listStartedIn`'s windowed shape
 *  instead of needing an unwindowed variant of its own. */
const EPOCH = new Date(0).toISOString()
const FAR_FUTURE = "9999-12-31T23:59:59Z"

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

interface RunInterval {
  startedAt: string
  finishedAt: string | null
}

/**
 * Mirrors `services/adoption.ts`'s own depth-of-use bucketing exactly (docs/metrics.md Group 1:
 * 20+ runs or any overlap is "deep", 5+ is "regular", otherwise "light" if they ran anything at
 * all, else "dormant"). Duplicated rather than imported -- that logic is private to
 * `services/adoption.ts`, which this build leaves untouched -- but both trace back to the exact
 * same fixture in docs/testing.md, so a change to one without the other is the bug to watch for.
 */
function hasOverlappingRuns(runs: readonly RunInterval[], now: string): boolean {
  const sorted = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
  for (let i = 1; i < sorted.length; i++) {
    const previousEnd = sorted[i - 1]!.finishedAt ?? now
    if (sorted[i]!.startedAt < previousEnd) return true
  }
  return false
}

function depthBucketFor(runs: readonly RunInterval[], now: string): DepthOfUseBucket {
  if (runs.length === 0) return "dormant"
  if (runs.length >= 20 || hasOverlappingRuns(runs, now)) return "deep"
  if (runs.length >= 5) return "regular"
  return "light"
}

export interface EngineerOverviewQuery {
  orgId: number
  engineerId: number
  from: string
  to: string
  agentKind?: string
}

export interface EngineerOverviewResult {
  finishedTasks: number
  successRate: {
    firstTry: { successes: number; endedRuns: number; rate: number }
    eventual: { succeededTasks: number; totalTasks: number; rate: number }
  }
  costPerFinishedTask: TaskCostStats
  outputs: { kind: ArtifactKind; count: number }[]
  mergedPullRequests: number
  quietFailures: number
  depthOfUse: DepthOfUseBucket
}

export class EngineerService {
  constructor(
    private readonly runs: RunRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly cost: CostService,
  ) {}

  getOverview(query: EngineerOverviewQuery): EngineerOverviewResult {
    const { orgId, engineerId, from, to, agentKind } = query
    const window: DateWindow = { from, to }
    const filters: RunFilters = { engineerId, agentKind }

    const endedRuns = this.runs.listEndedRuns(orgId, window, filters)
    const scored = endedRuns.filter((r) => !isCancelledEarly(r))
    const successes = scored.filter((r) => r.status === "succeeded").length
    const firstTry = { successes, endedRuns: scored.length, rate: safeRate(successes, scored.length) }

    let succeededTasks = 0
    let totalTasks = 0
    for (const { runs: chainRuns } of this.runs.listTaskOutcomesStartedIn(orgId, window, filters)) {
      const chainScored = chainRuns.filter((r) => !isCancelledEarly(r))
      if (chainScored.length === 0) continue
      totalTasks++
      if (chainScored.some((r) => r.status === "succeeded")) succeededTasks++
    }
    const eventual = { succeededTasks, totalTasks, rate: safeRate(succeededTasks, totalTasks) }

    // Cost per finished task already collapses retry chains and already accepts an engineerId
    // filter (RunRepository.listFinishedTaskCosts takes RunFilters) -- no engineer-specific
    // maths needed beyond calling it with this engineer's own filter.
    const costResult = this.cost.costPerFinishedTask(orgId, window, filters)

    // This engineer's own run ids, unbounded by the window -- a run that started well before
    // `from` can still produce (or merge) an artifact inside it (see the file header).
    const engineerRunIds = new Set(
      this.runs.listStartedIn(orgId, { from: EPOCH, to: FAR_FUTURE }, filters).map((r) => r.id),
    )
    // Outputs -- what was *produced* -- come from creation time; merged pull requests come from
    // merge time, which can be a different moment (and sometimes a different window) entirely.
    // Same distinction `ArtifactRepository.listMergedInWindow`'s own doc comment draws.
    const outputsInWindow = this.artifacts
      .listCreatedInWindow(orgId, window, { agentKind })
      .filter((a) => engineerRunIds.has(a.runId))
    const mergedInWindow = this.artifacts
      .listMergedInWindow(orgId, window, { agentKind })
      .filter((a) => engineerRunIds.has(a.runId))

    const outputCounts = new Map<ArtifactKind, number>(ALL_ARTIFACT_KINDS.map((k) => [k, 0]))
    for (const a of outputsInWindow) outputCounts.set(a.kind, (outputCounts.get(a.kind) ?? 0) + 1)
    const mergedPullRequests = mergedInWindow.filter((a) => a.kind === "pull_request").length

    // Depth of use over this same query window (the endpoint's own default is already a trailing
    // 30 days, matching AdoptionService's fixed 30-day depth-of-use window) rather than a second,
    // independent fixed window -- one window in, one bucket out, for this one endpoint.
    const runsInWindow = this.runs.listStartedIn(orgId, window, filters)
    const depthOfUse = depthBucketFor(
      runsInWindow.map((r) => ({ startedAt: r.startedAt, finishedAt: r.finishedAt })),
      to,
    )

    return {
      finishedTasks: costResult.perFinishedTask.taskCount,
      successRate: { firstTry, eventual },
      costPerFinishedTask: costResult.perFinishedTask,
      outputs: ALL_ARTIFACT_KINDS.map((kind) => ({ kind, count: outputCounts.get(kind)! })),
      mergedPullRequests,
      quietFailures: endedRuns.filter((r) => r.isQuietFailure).length,
      depthOfUse,
    }
  }
}
