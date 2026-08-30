/**
 * Turns the numeric-id domain objects services hand back into the string-id wire shapes
 * `packages/shared`'s response schemas expect -- docs/api.md's "An id is a short string" against
 * docs/data-model.md's "every id is the table's own integer primary key." Pure field mapping, no
 * SQL and no business rule, which is exactly what "shape the reply" (docs/architecture.md) means
 * for a controller -- these live in their own file only because several controllers share them.
 */

import type { RunArtifact, RunDetailResponse, RunPolicyFlag, RunSummary, RunToolCall, RunTurn, TaskAttempt } from "@app/shared"
import type { RunDetailData, RunWithPrimaryOutput, TaskAttemptData } from "../services/run-query.ts"

export function runSummaryWire(run: RunWithPrimaryOutput): RunSummary {
  return {
    id: String(run.id),
    teamId: String(run.teamId),
    engineerId: run.engineerId === null ? null : String(run.engineerId),
    agentKind: run.agentKind,
    trigger: run.trigger,
    repo: run.repo,
    branch: run.branch,
    parentRunId: run.parentRunId === null ? null : String(run.parentRunId),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    failureCause: run.failureCause,
    blame: run.blame,
    isQuietFailure: run.isQuietFailure,
    durationMs: run.durationMs,
    totalCostCents: run.totalCostCents,
    turnCount: run.turnCount,
    toolCallCount: run.toolCallCount,
    taskSummary: run.taskSummary,
    primaryOutputKind: run.primaryOutputKind,
  }
}

function taskAttemptWire(attempt: TaskAttemptData): TaskAttempt {
  return {
    runId: String(attempt.runId),
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    totalCostCents: attempt.totalCostCents,
    isSelf: attempt.isSelf,
    failureCause: attempt.failureCause,
    blame: attempt.blame,
  }
}

function runTurnWire(turn: RunDetailData["turns"][number]): RunTurn {
  return {
    id: String(turn.id),
    index: turn.turnIndex,
    startedAt: turn.startedAt,
    // A turn's own `finishedAt` isn't stored as a column -- see docs/data-model.md's `turns`
    // table: only `started_at` and `latency_ms` are. Derived here rather than in the repository,
    // since it's a one-line arithmetic reply-shaping step, not a query.
    finishedAt: new Date(new Date(turn.startedAt).getTime() + turn.latencyMs).toISOString(),
    model: turn.modelName,
    freshInputTokens: turn.tokensInFresh,
    cacheWriteTokens: turn.tokensCacheWrite,
    cacheReadTokens: turn.tokensInCached,
    outputTokens: turn.tokensOut,
    thinkingTokens: turn.tokensThinking,
    toolSeconds: turn.latencyMs / 1000,
    costCents: turn.costCents,
  }
}

function runToolCallWire(call: RunDetailData["toolCalls"][number]): RunToolCall {
  return {
    id: String(call.id),
    turnId: String(call.turnId),
    name: call.toolName,
    startedAt: call.startedAt,
    durationMs: call.durationMs,
    outcome: call.outcome,
    // `docs/data-model.md`'s `tool_calls` table has no free-text summary column, only a nullable
    // `target` (what it acted on) and `errorType` (set only when `outcome` is `error`) -- the
    // closest honest stand-in available. See this build's report for the full callout.
    summary: call.target ?? call.errorType ?? call.toolName,
  }
}

function runArtifactWire(artifact: RunDetailData["artifacts"][number]): RunArtifact {
  return {
    id: String(artifact.id),
    kind: artifact.kind,
    url: artifact.ref,
    merged: artifact.mergedAt === null ? (artifact.kind === "pull_request" ? false : null) : true,
    createdAt: artifact.createdAt,
  }
}

function runPolicyFlagWire(flag: RunDetailData["policyFlags"][number]): RunPolicyFlag {
  return {
    id: String(flag.id),
    turnId: flag.turnId === null ? null : String(flag.turnId),
    kind: flag.kind,
    severity: flag.severity,
    status: flag.disposition,
    detail: flag.resource ?? "",
    createdAt: flag.createdAt,
  }
}

export function runDetailWire(detail: RunDetailData): RunDetailResponse {
  return {
    ...runSummaryWire(detail.run),
    taskAttempts: detail.taskAttempts.map(taskAttemptWire),
    turns: detail.turns.map(runTurnWire),
    toolCalls: detail.toolCalls.map(runToolCallWire),
    artifacts: detail.artifacts.map(runArtifactWire),
    policyFlags: detail.policyFlags.map(runPolicyFlagWire),
  }
}
