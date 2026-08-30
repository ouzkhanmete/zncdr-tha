/**
 * `GET /api/runs`, `GET /api/runs/:runId`, and the run-listing half of
 * `GET /api/engineers/:id/runs` -- docs/api.md section 7. No metric maths here, just assembling
 * one run (or a page of them) from across several repositories, which is exactly the kind of
 * "call other systems" work a service does and a controller never touches a repository to do
 * (docs/architecture.md).
 *
 * `primaryOutputKind` -- docs/api.md's answer to "a run list needs one output icon per row
 * without 200 extra round trips" -- is computed here, once, by joining the fetched run ids with
 * `ArtifactRepository.listPrimaryKindByRunIds`, exactly as that method's own doc comment
 * prescribes: "in the service that builds a RunSummary, not by adding an artifacts join to every
 * run query in the repository."
 */

import type { ArtifactKind, Artifact, PolicyFlag, Run, ToolCall, Turn } from "@app/shared"
import type { ArtifactRepository } from "../repositories/artifacts.ts"
import type { ModelRepository } from "../repositories/models.ts"
import type { PolicyFlagRepository } from "../repositories/policy-flags.ts"
import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { ToolCallRepository } from "../repositories/tool-calls.ts"
import type { DateWindow } from "../repositories/types.ts"
import type { TurnRepository } from "../repositories/turns.ts"

/** A `Run` plus the one derived field a run list needs that isn't a column on the table itself. */
export interface RunWithPrimaryOutput extends Run {
  primaryOutputKind: ArtifactKind | null
}

export interface RunSearchQuery {
  orgId: number
  window: DateWindow
  filters?: RunFilters
  limit: number
  offset: number
}

export interface RunSearchResultData {
  items: RunWithPrimaryOutput[]
  total: number
}

/** One attempt in a task's chain, alongside the run detail screen's own timeline data --
 *  docs/api.md's `RunDetail`. */
export interface TaskAttemptData {
  runId: number
  attemptNumber: number
  status: Run["status"]
  startedAt: string
  totalCostCents: number
  isSelf: boolean
  failureCause: Run["failureCause"]
  blame: Run["blame"]
}

/** `docs/data-model.md`'s `turns` table stores a `model_id` foreign key, not a name -- this is
 *  where that gets resolved, once, so a controller never has to touch `ModelRepository` itself
 *  (a controller never touches a repository, docs/architecture.md). */
export interface TurnWithModel extends Turn {
  modelName: string
}

/** `docs/data-model.md`'s `tool_calls` table carries no timestamp of its own -- see this file's
 *  `getDetail` for why its parent turn's `startedAt` is the closest honest stand-in. */
export interface ToolCallWithStartedAt extends ToolCall {
  startedAt: string
}

export interface RunDetailData {
  run: RunWithPrimaryOutput
  taskAttempts: TaskAttemptData[]
  turns: TurnWithModel[]
  toolCalls: ToolCallWithStartedAt[]
  artifacts: Artifact[]
  policyFlags: PolicyFlag[]
}

function withPrimaryOutputKind(
  runs: readonly Run[],
  artifacts: ArtifactRepository,
): RunWithPrimaryOutput[] {
  const primaryKinds = artifacts.listPrimaryKindByRunIds(runs.map((r) => r.id))
  return runs.map((r) => ({ ...r, primaryOutputKind: primaryKinds.get(r.id) ?? null }))
}

export class RunQueryService {
  constructor(
    private readonly runs: RunRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly turns: TurnRepository,
    private readonly toolCalls: ToolCallRepository,
    private readonly policyFlags: PolicyFlagRepository,
    private readonly models: ModelRepository,
  ) {}

  /** A paged, filtered search over runs -- what any drill-down table in docs/api.md section 7
   *  (and the engineer's own run list) is built from. Not restricted to finished runs, on
   *  purpose: a search screen wants to find a run still in progress too. */
  search(query: RunSearchQuery): RunSearchResultData {
    const { orgId, window, filters, limit, offset } = query
    const { items, total } = this.runs.search(orgId, window, { ...(filters ?? {}), limit, offset })
    return { items: withPrimaryOutputKind(items, this.artifacts), total }
  }

  /** Everything one run screen needs, or `undefined` if the id matches nothing -- the controller
   *  turns that into the 404 docs/api.md's `GET /api/runs/:runId` documents. */
  getDetail(runId: number): RunDetailData | undefined {
    const run = this.runs.findById(runId)
    if (!run) return undefined

    // The chain is anchored on the *first* attempt's id -- a run with no parent already is its
    // own anchor; a retry looks its parent up. `listChainMembers` already returns every member,
    // first attempt first (docs/data-model.md).
    const taskId = run.parentRunId ?? run.id
    const chain = this.runs.listChainMembers(taskId)
    const taskAttempts: TaskAttemptData[] = chain.map((attempt, index) => ({
      runId: attempt.id,
      attemptNumber: index + 1,
      status: attempt.status,
      startedAt: attempt.startedAt,
      totalCostCents: attempt.totalCostCents,
      isSelf: attempt.id === run.id,
      failureCause: attempt.failureCause,
      blame: attempt.blame,
    }))

    const turns = this.turns.listByRunId(run.id)
    const turnsWithModel: TurnWithModel[] = turns.map((t) => ({
      ...t,
      modelName: this.models.findById(t.modelId)?.name ?? String(t.modelId),
    }))

    // A tool call carries no timestamp of its own (docs/data-model.md's `tool_calls` table has
    // none). Its parent turn's own `startedAt` is the closest honest stand-in -- a tool call
    // happens somewhere inside the turn that made it, even if not at the exact same instant.
    const turnStartedAtById = new Map(turns.map((t) => [t.id, t.startedAt]))
    const toolCalls: ToolCallWithStartedAt[] = this.toolCalls
      .listByRunId(run.id)
      .map((c) => ({ ...c, startedAt: turnStartedAtById.get(c.turnId) ?? run.startedAt }))

    return {
      run: withPrimaryOutputKind([run], this.artifacts)[0]!,
      taskAttempts,
      turns: turnsWithModel,
      toolCalls,
      artifacts: this.artifacts.listByRunId(run.id),
      policyFlags: this.policyFlags.listByRunId(run.id),
    }
  }
}
