import { z } from "zod"
import { artifactKind, blame, disposition, failureCause, policyFlagKind, runStatus, severity, toolCallOutcome, trigger, turnFinishReason } from "./enums.ts"
import { cents } from "./money.ts"

// One schema per table in docs/data-model.md, matching its columns and nullability exactly.
// Field names are camelCase here; mapping a column's snake_case name onto these is a
// repository's job (see docs/architecture.md), not this package's.
//
// Ids are numbers, matching each table's INTEGER PRIMARY KEY. They only become strings at the
// API boundary -- see api.ts and docs/api.md's "An id is a short string."

const isoDateTime = z.string().datetime()

export const org = z.object({
  id: z.number().int(),
  name: z.string(),
  licensedSeats: z.number().int().nonnegative(),
  createdAt: isoDateTime,
})
export type Org = z.infer<typeof org>

export const team = z.object({
  id: z.number().int(),
  orgId: z.number().int(),
  name: z.string(),
  createdAt: isoDateTime,
})
export type Team = z.infer<typeof team>

export const engineer = z.object({
  id: z.number().int(),
  orgId: z.number().int(),
  // Nullable: a person can exist between teams. A run never looks up someone's team through
  // this column -- see runs.teamId below.
  teamId: z.number().int().nullable(),
  handle: z.string(),
  displayName: z.string(),
  seatGrantedAt: isoDateTime,
  seatActive: z.boolean(),
})
export type Engineer = z.infer<typeof engineer>

// One row per model per price change, not one row per model -- a turn always points at the
// exact row that was true when it ran, so a later price change never rewrites an old bill.
export const model = z.object({
  id: z.number().int(),
  provider: z.string(),
  name: z.string(),
  inputPricePerMtokCents: cents,
  cachedInputPricePerMtokCents: cents,
  cacheWritePricePerMtokCents: cents,
  outputPricePerMtokCents: cents,
  effectiveFrom: isoDateTime,
})
export type Model = z.infer<typeof model>

export const run = z
  .object({
    id: z.number().int(),
    // Stamped at the moment the run starts, never looked up through the engineer -- see the
    // callout in docs/data-model.md on why this isn't a join through engineers.teamId.
    orgId: z.number().int(),
    teamId: z.number().int(),
    // Null when trigger is "automation", since those runs have no person behind them.
    engineerId: z.number().int().nullable(),
    // Points at the first run of this task's chain of attempts; null on that first run itself.
    parentRunId: z.number().int().nullable(),
    agentKind: z.string(),
    trigger,
    // Null for tasks with no repo, like a report; branch is null whenever repo is.
    repo: z.string().nullable(),
    branch: z.string().nullable(),
    startedAt: isoDateTime,
    actorUtcOffsetMinutes: z.number().int(),
    finishedAt: isoDateTime.nullable(),
    status: runStatus,
    failureCause: failureCause.nullable(),
    blame: blame.nullable(),
    isQuietFailure: z.boolean(),
    // Capped at the timeout limit for a timed-out run, not its true elapsed time. Null while running.
    durationMs: z.number().int().nonnegative().nullable(),
    totalCostCents: cents,
    turnCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    // A short, one-line description of the task -- never the full prompt. See the callout under
    // the runs table in docs/data-model.md for why the full text is deliberately not stored.
    taskSummary: z.string(),
  })
  .superRefine((r, ctx) => {
    // Mirrors the two-way CHECK on runs.failure_cause / runs.blame in docs/data-model.md: a
    // failed or timed-out run always has both; every other status has neither.
    const endedInFailure = r.status === "failed" || r.status === "timed_out"
    const hasFailureInfo = r.failureCause !== null && r.blame !== null
    if (endedInFailure && !hasFailureInfo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a failed or timed_out run needs both a failureCause and a blame",
        path: ["failureCause"],
      })
    }
    if (!endedInFailure && (r.failureCause !== null || r.blame !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only a failed or timed_out run can carry a failureCause or a blame",
        path: ["failureCause"],
      })
    }
    // A quiet failure is, by definition, a run that reported success -- see docs/data-model.md.
    if (r.isQuietFailure && r.status !== "succeeded") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "isQuietFailure can only be true when status is succeeded",
        path: ["isQuietFailure"],
      })
    }
    if (r.finishedAt !== null && new Date(r.finishedAt) < new Date(r.startedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "finishedAt cannot come before startedAt",
        path: ["finishedAt"],
      })
    }
  })
export type Run = z.infer<typeof run>

export const turn = z.object({
  id: z.number().int(),
  runId: z.number().int(),
  turnIndex: z.number().int().nonnegative(),
  modelId: z.number().int(),
  tokensInFresh: z.number().int().nonnegative(),
  tokensInCached: z.number().int().nonnegative(),
  tokensCacheWrite: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  tokensThinking: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  finishReason: turnFinishReason,
  costCents: cents,
  startedAt: isoDateTime,
})
export type Turn = z.infer<typeof turn>

export const toolCall = z.object({
  id: z.number().int(),
  // Copied down from the turn so run-level rollups don't need to join through turns for this.
  runId: z.number().int(),
  turnId: z.number().int(),
  toolName: z.string(),
  durationMs: z.number().int().nonnegative(),
  outcome: toolCallOutcome,
  target: z.string().nullable(),
  errorType: z.string().nullable(),
  costCents: cents,
})
export type ToolCall = z.infer<typeof toolCall>

export const artifact = z
  .object({
    id: z.number().int(),
    runId: z.number().int(),
    kind: artifactKind,
    ref: z.string(),
    createdAt: isoDateTime,
    // Null while an open pull request waits; always null for kinds nothing merges.
    mergedAt: isoDateTime.nullable(),
    // Can only be set if mergedAt is -- you can't revert what was never kept.
    revertedAt: isoDateTime.nullable(),
  })
  .refine((a) => a.revertedAt === null || a.mergedAt !== null, {
    message: "revertedAt can only be set once mergedAt is set",
    path: ["revertedAt"],
  })
export type Artifact = z.infer<typeof artifact>

export const policyFlag = z.object({
  id: z.number().int(),
  runId: z.number().int(),
  // Set when the flag ties to one specific model reply rather than the run as a whole.
  turnId: z.number().int().nullable(),
  kind: policyFlagKind,
  severity,
  disposition,
  resource: z.string().nullable(),
  createdAt: isoDateTime,
})
export type PolicyFlag = z.infer<typeof policyFlag>

export const budget = z
  .object({
    id: z.number().int(),
    teamId: z.number().int(),
    month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM"),
    limitCents: cents,
    warnCents: cents,
    stopCents: cents,
    updatedAt: isoDateTime,
  })
  .refine((b) => b.warnCents <= b.stopCents && b.stopCents <= b.limitCents, {
    message: "warnCents must sit at or below stopCents, and stopCents at or below limitCents",
    path: ["warnCents"],
  })
export type Budget = z.infer<typeof budget>
