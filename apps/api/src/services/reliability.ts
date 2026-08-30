/**
 * Group 4 -- Reliability: what broke and whose problem it is. See docs/metrics.md.
 *
 * Every failure carries whose problem it is -- org setup, platform, or task (docs/decisions.md
 * entry 8). A cancelled run is nobody's fault: it has no cause and no blame, so it is pulled out
 * before either half of the failure rate is worked out, and counted on its own instead.
 */

import { failureCause } from "@app/shared"
import type { Blame, FailureCause, Run, RunStatus } from "@app/shared"
import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { DateWindow } from "../repositories/types.ts"
import { percentile } from "./stats.ts"

/**
 * Whose problem each cause is -- docs/metrics.md Group 4's table, owned here rather than trusted
 * off whatever `runs.blame` happens to hold. Blame is fully determined by cause, so re-deriving
 * it from this one map is what guarantees "every cause lands in exactly one bucket" as a property
 * of the code, not a hope about the data. `Record<FailureCause, Blame>` also means the compiler
 * refuses to build if a cause is ever added to the enum and forgotten here.
 */
export const FAILURE_CAUSE_BLAME: Record<FailureCause, Blame> = {
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

const ALL_CAUSES = failureCause.options
const ALL_BLAMES: readonly Blame[] = ["org_setup", "platform", "task"]

/** A run that "gave up" for this number's purposes -- see the note on `timeBeforeGivingUp`
 *  below for why `timed_out` is included here even though it is excluded from run-time
 *  percentiles in speed.ts. */
const GAVE_UP_STATUSES = new Set<RunStatus>(["failed", "timed_out"])

/** A rate with nothing to divide by is 0, not NaN -- there is nothing wrong to report, and a
 *  chart showing NaN is worse than one showing a quiet zero. */
function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export interface ReliabilityQuery {
  orgId: number
  /** Plain range for quiet failures, retry rate, and time before giving up. Failure rate ignores
   *  this and always computes its own trailing 7-day and 30-day windows ending at `to`. */
  from: string
  to: string
  filters?: RunFilters
}

export interface FailureCauseCount {
  cause: FailureCause
  count: number
  rate: number
}

export interface FailureBlameCount {
  blame: Blame
  count: number
  rate: number
}

export interface FailureWindowResult {
  /** All runs that reached an end in the window, cancelled runs excluded -- the bottom of both
   *  halves of the failure rate. See docs/metrics.md Group 4. */
  endedRuns: number
  /** Cancelled runs in the window, counted on their own -- excluded from `endedRuns` and from
   *  every rate below, on purpose. */
  cancelled: number
  byBlame: FailureBlameCount[]
  byCause: FailureCauseCount[]
}

export interface ReliabilityResult {
  from: string
  to: string
  failureRate: {
    last7d: FailureWindowResult
    last30d: FailureWindowResult
  }
  quietFailures: { count: number; rate: number }
  retryRate: { tasksNeedingRetry: number; totalTasks: number; rate: number }
  timeBeforeGivingUp: { p50Ms: number | null; p95Ms: number | null }
}

const DAY_MS = 24 * 60 * 60 * 1000

export class ReliabilityService {
  constructor(private readonly runRepo: RunRepository) {}

  getReliability(query: ReliabilityQuery): ReliabilityResult {
    const { orgId, from, to, filters } = query
    const toMs = new Date(to).getTime()
    const last7d: DateWindow = { from: new Date(toMs - 7 * DAY_MS).toISOString(), to }
    const last30d: DateWindow = { from: new Date(toMs - 30 * DAY_MS).toISOString(), to }

    const plainWindow: DateWindow = { from, to }
    const endedRuns = this.runRepo.listEndedRuns(orgId, plainWindow, filters)

    return {
      from,
      to,
      failureRate: {
        last7d: this.failureWindow(orgId, last7d, filters),
        last30d: this.failureWindow(orgId, last30d, filters),
      },
      quietFailures: this.quietFailures(endedRuns),
      retryRate: this.retryRate(orgId, plainWindow, filters),
      timeBeforeGivingUp: this.timeBeforeGivingUp(endedRuns),
    }
  }

  private failureWindow(orgId: number, window: DateWindow, filters?: RunFilters): FailureWindowResult {
    const runs = this.runRepo.listEndedRuns(orgId, window, filters)
    const cancelled = runs.filter((r) => r.status === "cancelled").length
    // Left out of both halves on purpose -- a cancelled run has no cause and no blame.
    const endedRuns = runs.length - cancelled

    const causeCounts = new Map<FailureCause, number>()
    for (const run of runs) {
      if (run.failureCause === null) continue
      causeCounts.set(run.failureCause, (causeCounts.get(run.failureCause) ?? 0) + 1)
    }

    const byCause: FailureCauseCount[] = ALL_CAUSES.map((cause) => {
      const count = causeCounts.get(cause) ?? 0
      return { cause, count, rate: safeRate(count, endedRuns) }
    })

    // Derived from byCause through FAILURE_CAUSE_BLAME, not from runs[i].blame directly -- see
    // that map's own comment for why. This also means byBlame's counts can never disagree with
    // byCause's: every failure counted once above is counted exactly once here.
    const blameCounts = new Map<Blame, number>()
    for (const { cause, count } of byCause) {
      const blame = FAILURE_CAUSE_BLAME[cause]
      blameCounts.set(blame, (blameCounts.get(blame) ?? 0) + count)
    }
    const byBlame: FailureBlameCount[] = ALL_BLAMES.map((blame) => {
      const count = blameCounts.get(blame) ?? 0
      return { blame, count, rate: safeRate(count, endedRuns) }
    })

    return { endedRuns, cancelled, byBlame, byCause }
  }

  private quietFailures(endedRuns: readonly Run[]): { count: number; rate: number } {
    const count = endedRuns.filter((r) => r.isQuietFailure).length
    return { count, rate: safeRate(count, endedRuns.length) }
  }

  private retryRate(
    orgId: number,
    window: DateWindow,
    filters?: RunFilters,
  ): { tasksNeedingRetry: number; totalTasks: number; rate: number } {
    const outcomes = this.runRepo.listTaskOutcomesStartedIn(orgId, window, filters)
    const totalTasks = outcomes.length
    const tasksNeedingRetry = outcomes.filter((o) => o.runs.length > 1).length
    return { tasksNeedingRetry, totalTasks, rate: safeRate(tasksNeedingRetry, totalTasks) }
  }

  /**
   * How long a failing run went before it stopped -- `failed` and `timed_out` both count as
   * "gave up" for this number. Only run-time percentiles (speed.ts) exclude timed-out runs,
   * because there the cap makes the *system* look faster than it is. Here the question is the
   * opposite: how long did a doomed run burn budget before someone (or something) noticed, and a
   * run that used its entire time limit before giving up is exactly the slow-motion failure this
   * number exists to catch, not a distortion to hide.
   */
  private timeBeforeGivingUp(endedRuns: readonly Run[]): { p50Ms: number | null; p95Ms: number | null } {
    const durations = endedRuns
      .filter((r): r is Run & { durationMs: number } => GAVE_UP_STATUSES.has(r.status) && r.durationMs !== null)
      .map((r) => r.durationMs)
    return { p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) }
  }
}
