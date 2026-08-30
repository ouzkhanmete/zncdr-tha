/**
 * Group 2 -- Outcome: did anything useful come out. See docs/metrics.md.
 *
 * First-try and eventual success rate answer different questions from the same rows -- how good
 * the agent is on its own, versus whether the person got what they needed after every retry --
 * and both are worked out here, side by side, never collapsed into one number. A run cancelled in
 * its first few seconds is neither a win nor a loss for either question, so both computations
 * pull it out before scoring anything, the same 5-second rule docs/data-model.md's reference SQL
 * uses -- but it still gets its own count so it doesn't quietly disappear.
 */

import { artifactKind } from "@app/shared"
import type { ArtifactKind, OutcomesResponse, Run, RunStatus, SuccessRateWindow } from "@app/shared"
import { sumCents } from "@app/shared"
import type { ArtifactRepository } from "../repositories/artifacts.ts"
import type { RunRepository, TaskOutcome } from "../repositories/runs.ts"
import type { DateWindow, ScopeFilters } from "../repositories/types.ts"

const DAY_MS = 24 * 60 * 60 * 1000

/** A run cancelled before this many milliseconds in is treated as "before the agent did
 *  anything" -- neither a win nor a loss. Matches the cutoff in docs/data-model.md section 4's
 *  reference SQL for both success-rate queries. */
const CANCELLED_EARLY_MS = 5_000

/** A merged change reverted or heavily rewritten within this many days still counts as rework --
 *  see docs/metrics.md's "Rework rate". */
const REWORK_WINDOW_DAYS = 14

const ALL_ARTIFACT_KINDS = artifactKind.options

export interface OutcomeQuery {
  orgId: number
  /** The plain window for finished tasks, outputs, merged pull requests, and rework rate.
   *  `successRate` ignores both and always computes its own trailing 7-day and 30-day windows
   *  ending at `to` instead -- see docs/api.md's note on `GET /api/metrics/outcomes`. */
  from: string
  to: string
  filters?: ScopeFilters
}

/** A rate with nothing to divide by is 0, not NaN -- the count sitting next to it is what tells a
 *  reader "0 because nothing happened yet" apart from a real 0% outcome. */
function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function windowEndingAt(to: string, days: number): DateWindow {
  return { from: new Date(new Date(to).getTime() - days * DAY_MS).toISOString(), to }
}

function isCancelledEarly(run: Pick<Run, "status" | "durationMs">): boolean {
  return run.status === "cancelled" && run.durationMs !== null && run.durationMs < CANCELLED_EARLY_MS
}

/** First try: does the agent get it right on its own, on the first attempt -- every run that
 *  reached an end in the window, cancelled-early runs pulled out first. */
function firstTryFromEndedRuns(endedRuns: readonly Run[]): {
  successes: number
  endedRuns: number
  rate: number
  cancelledEarly: number
} {
  const scored = endedRuns.filter((r) => !isCancelledEarly(r))
  const successes = scored.filter((r) => r.status === "succeeded").length
  return {
    successes,
    endedRuns: scored.length,
    rate: safeRate(successes, scored.length),
    cancelledEarly: endedRuns.length - scored.length,
  }
}

/** In the end: did the person get what they needed, retries included -- a task's whole chain
 *  collapses to one win-or-lose answer. A task whose every attempt was cancelled early has
 *  nothing left to score once those are pulled out, so it drops out of both the top and the
 *  bottom entirely -- the same thing docs/data-model.md's reference SQL does by grouping from an
 *  already-filtered `chain_members`, not a bug to route around. */
function eventualFromTaskOutcomes(taskOutcomes: readonly TaskOutcome[]): {
  succeededTasks: number
  totalTasks: number
  rate: number
} {
  let succeededTasks = 0
  let totalTasks = 0
  for (const { runs } of taskOutcomes) {
    const scored = runs.filter((r) => !isCancelledEarly(r))
    if (scored.length === 0) continue
    totalTasks++
    if (scored.some((r) => r.status === "succeeded")) succeededTasks++
  }
  return { succeededTasks, totalTasks, rate: safeRate(succeededTasks, totalTasks) }
}

function wasReworkedWithinWindow(artifact: { mergedAt: string | null; revertedAt: string | null }): boolean {
  if (artifact.mergedAt === null || artifact.revertedAt === null) return false
  const days = (new Date(artifact.revertedAt).getTime() - new Date(artifact.mergedAt).getTime()) / DAY_MS
  return days <= REWORK_WINDOW_DAYS
}

export class OutcomeService {
  constructor(
    private readonly runs: RunRepository,
    private readonly artifacts: ArtifactRepository,
  ) {}

  /**
   * The whole of docs/metrics.md Group 2 in one pass, shaped exactly like `GET
   * /api/metrics/outcomes`'s response so a controller can hand this straight back.
   */
  getOutcomes(query: OutcomeQuery): OutcomesResponse {
    const { orgId, from, to, filters } = query
    const plainWindow: DateWindow = { from, to }
    // Two different questions, two different repository calls -- see each method's own doc
    // comment in artifacts.ts. "What came out" is about when a thing was made; merged pull
    // requests and rework rate are about when a change merged.
    const artifactsCreatedInWindow = this.artifacts.listCreatedInWindow(orgId, plainWindow, filters)
    const artifactsMergedInWindow = this.artifacts.listMergedInWindow(orgId, plainWindow, filters)

    return {
      from,
      to,
      successRate: {
        last7d: this.successRateForWindow(orgId, windowEndingAt(to, 7), filters),
        last30d: this.successRateForWindow(orgId, windowEndingAt(to, 30), filters),
      },
      finishedTasks: this.finishedTasks(orgId, plainWindow, filters),
      outputs: this.outputs(artifactsCreatedInWindow),
      mergedPullRequests: this.mergedPullRequests(artifactsMergedInWindow),
      reworkRate: this.reworkRate(artifactsMergedInWindow),
    }
  }

  /** Runs with no end yet -- the live "in progress" count and what they've cost so far. Has no
   *  date range of its own on purpose: this is happening right now, not over a reporting
   *  window -- see `GET /api/metrics/in-progress` in docs/api.md. */
  inProgress(orgId: number, filters?: ScopeFilters): { count: number; costSoFarCents: number } {
    const running = this.runs.listRunning(orgId, filters)
    return { count: running.length, costSoFarCents: sumCents(running.map((r) => r.totalCostCents)) }
  }

  private successRateForWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): SuccessRateWindow {
    const endedRuns = this.runs.listEndedRuns(orgId, window, filters)
    const firstTry = firstTryFromEndedRuns(endedRuns)
    const eventual = eventualFromTaskOutcomes(this.runs.listTaskOutcomesStartedIn(orgId, window, filters))
    return {
      firstTry: { successes: firstTry.successes, endedRuns: firstTry.endedRuns, rate: firstTry.rate },
      eventual,
      // Drawn from the same "ended in this window" population first-try scores, not eventual's
      // task-anchored one -- there is one cancelled-early count per window, not one per question.
      cancelledEarly: firstTry.cancelledEarly,
    }
  }

  /** Count of task chains that ended in success -- a task retried three times counts once, not
   *  three, because `listFinishedTaskCosts` already collapses the chain via
   *  `COALESCE(parent_run_id, id)` before this ever sees it. This is the number docs/metrics.md
   *  says the money service's cost-per-finished-task divides by; the cost itself is that
   *  service's job, not this one's. */
  private finishedTasks(orgId: number, window: DateWindow, filters?: ScopeFilters): number {
    return this.runs.listFinishedTaskCosts(orgId, window, filters).filter((t) => t.everSucceeded).length
  }

  /** What came out, split by kind -- every kind always present, zero-filled, so a chart never
   *  has to guess whether an absent kind means zero or means the number never loaded. Answers
   *  "what was produced", from artifacts *created* in the window -- see
   *  `ArtifactRepository.listCreatedInWindow`'s own doc comment for why that's the right window
   *  for this question and the wrong one for the next method. */
  private outputs(artifactsCreatedInWindow: readonly { kind: ArtifactKind }[]): { kind: ArtifactKind; count: number }[] {
    const counts = new Map<ArtifactKind, number>(ALL_ARTIFACT_KINDS.map((kind) => [kind, 0]))
    for (const a of artifactsCreatedInWindow) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1)
    return ALL_ARTIFACT_KINDS.map((kind) => ({ kind, count: counts.get(kind)! }))
  }

  /** The honest number: pull requests a person actually merged, not just opened. Built from
   *  artifacts that *merged* in the window, so a pull request opened just before the window but
   *  merged inside it counts -- opening it isn't what matters here, merging it is. */
  private mergedPullRequests(artifactsMergedInWindow: readonly { kind: ArtifactKind }[]): number {
    return artifactsMergedInWindow.filter((a) => a.kind === "pull_request").length
  }

  /** Share of merged changes reverted or heavily rewritten within 14 days -- the quality half
   *  that sits beside finished tasks on every screen (docs/decisions.md entry 4). Built from
   *  artifacts that merged in the window, same reasoning as `mergedPullRequests`: rework rate is
   *  defined over merged changes, not over when they were first created. */
  private reworkRate(
    artifactsMergedInWindow: readonly { mergedAt: string | null; revertedAt: string | null }[],
  ): { revertedOrRewritten: number; totalMerged: number; rate: number } {
    const revertedOrRewritten = artifactsMergedInWindow.filter(wasReworkedWithinWindow).length
    return {
      revertedOrRewritten,
      totalMerged: artifactsMergedInWindow.length,
      rate: safeRate(revertedOrRewritten, artifactsMergedInWindow.length),
    }
  }
}
