/**
 * Speed: turn time and run time, kept apart. See docs/metrics.md's Speed section.
 *
 * Turn time is how long one model reply took. Run time is wall clock for the whole task,
 * tools and waiting included. They are never merged under one word, and neither is "latency" --
 * that word alone doesn't say which one. Runs that timed out are reported apart from run time,
 * never blended in: a timeout caps a run's duration at the limit, so mixing it in would make a
 * rise in timeouts look exactly like the system getting faster.
 */

import type { Run, RunStatus } from "@app/shared"
import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { ScopeFilters } from "../repositories/types.ts"
import type { TurnRepository } from "../repositories/turns.ts"
import { percentile } from "./stats.ts"

/**
 * Which run statuses count toward run-time percentiles -- `succeeded` and `failed` only. Matches
 * docs/data-model.md section 4's reference SQL exactly: `timed_out` is excluded because its
 * duration is capped at the limit, not its true elapsed time (see docs/decisions.md entry 10),
 * and `cancelled` is excluded because a run a person walked away from was never really timed at
 * all -- neither one is an honest "how long did this take".
 */
const RUN_TIME_STATUSES = new Set<RunStatus>(["succeeded", "failed"])

export interface SpeedQuery {
  orgId: number
  from: string
  to: string
  filters?: ScopeFilters
}

export interface PercentileTriple {
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
}

export interface SpeedResult {
  from: string
  to: string
  turnTime: PercentileTriple
  runTime: PercentileTriple
  /** Charted apart, never folded into `runTime` above. */
  timedOutRuns: number
}

function threePercentiles(values: readonly number[]): PercentileTriple {
  // Always one pass over these exact raw values -- never an average of percentiles computed over
  // some other grouping. See docs/metrics.md's "How percentiles are worked out" and
  // docs/decisions.md entry 9.
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
  }
}

export class SpeedService {
  constructor(
    private readonly runRepo: RunRepository,
    private readonly turnRepo: TurnRepository,
  ) {}

  getSpeed(query: SpeedQuery): SpeedResult {
    const { orgId, from, to, filters } = query
    const window = { from, to }

    const turns = this.turnRepo.listStartedInWindow(orgId, window, filters)
    const turnDurations = turns.map((t) => t.latencyMs)

    const runs = this.runRepo.listEndedRuns(orgId, window, filters as RunFilters | undefined)
    const timedOutRuns = runs.filter((r) => r.status === "timed_out").length
    const runDurations = runs
      .filter((r): r is Run & { durationMs: number } => RUN_TIME_STATUSES.has(r.status) && r.durationMs !== null)
      .map((r) => r.durationMs)

    return {
      from,
      to,
      turnTime: threePercentiles(turnDurations),
      runTime: threePercentiles(runDurations),
      timedOutRuns,
    }
  }
}
