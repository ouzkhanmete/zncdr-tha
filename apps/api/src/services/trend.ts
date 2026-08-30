/**
 * `GET /api/trend` and its engineer-scoped sibling `GET /api/engineers/:id/trend` -- runs,
 * finished tasks, success rate, and cost per finished task, one point per day or week across a
 * date range. Both endpoints share this one point shape and this one bucketing rule (docs/api.md
 * section 4: "the org/team equivalent of the engineer's own trend -- same shape, scoped
 * differently"), so it lives in one service rather than two copies that could drift apart.
 *
 * No `docs/plan.md` Step 5 group owns this number on its own -- it leans on the same repository
 * methods `CostService` and `OutcomeService` already use (`listFinishedTaskCosts`,
 * `listEndedRuns`), just called once per period instead of once for the whole range, so each
 * period gets its own already-collapsed task chains and already-filtered ended runs straight from
 * the repository -- see docs/decisions.md entry 10: "a repository still does the part SQL is
 * genuinely better at: collapsing a retry chain... filtering to finished runs... so what crosses
 * the boundary is a small grouped row set."
 */

import type { Run, TrendPoint, TrendResponse } from "@app/shared"
import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { DateWindow } from "../repositories/types.ts"
import { median } from "./stats.ts"

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** A run cancelled before this many milliseconds in is "before the agent did anything" -- neither
 *  a win nor a loss, so it drops out of first-try success rate entirely. Mirrors
 *  `services/outcome.ts`'s own `CANCELLED_EARLY_MS`, which is private to that file -- both trace
 *  back to the same 5-second rule in docs/data-model.md section 4's reference SQL, so a change to
 *  one without the other is the actual bug to watch for, not this duplication itself. */
const CANCELLED_EARLY_MS = 5_000

export function isCancelledEarly(run: Pick<Run, "status" | "durationMs">): boolean {
  return run.status === "cancelled" && run.durationMs !== null && run.durationMs < CANCELLED_EARLY_MS
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Half-open windows of exactly one day or one week, starting at `from` and covering every moment
 * up to `to` -- the last one clipped short rather than overshooting, so no period ever reaches
 * past the range a caller actually asked for. Deliberately anchored to `from` itself rather than
 * the UTC calendar day it falls on: every other window in this API (`from` inclusive, `to`
 * exclusive) is a raw instant, not a calendar box, and quantizing to midnight here would pull in
 * runs from just before `from` on the very first point.
 */
function buildPeriods(from: string, to: string, interval: "day" | "week"): DateWindow[] {
  const stepMs = interval === "day" ? DAY_MS : WEEK_MS
  const toMs = new Date(to).getTime()
  const periods: DateWindow[] = []
  let cursor = new Date(from).getTime()
  while (cursor < toMs) {
    const end = Math.min(cursor + stepMs, toMs)
    periods.push({ from: new Date(cursor).toISOString(), to: new Date(end).toISOString() })
    cursor = end
  }
  return periods
}

export interface TrendQuery {
  orgId: number
  from: string
  to: string
  interval: "day" | "week"
  filters?: RunFilters
}

export class TrendService {
  constructor(private readonly runs: RunRepository) {}

  getTrend(query: TrendQuery): TrendResponse {
    const { orgId, from, to, interval, filters } = query
    const points = buildPeriods(from, to, interval).map((period) => this.pointFor(orgId, period, filters))
    return { interval, points }
  }

  private pointFor(orgId: number, period: DateWindow, filters?: RunFilters): TrendPoint {
    const runsStarted = this.runs.search(orgId, period, { ...(filters ?? {}), limit: 1, offset: 0 }).total

    const chains = this.runs.listFinishedTaskCosts(orgId, period, filters)
    const finishedCosts = chains.filter((c) => c.everSucceeded).map((c) => c.costCents)
    const medianRaw = median(finishedCosts)

    const endedRuns = this.runs.listEndedRuns(orgId, period, filters)
    const scored = endedRuns.filter((r) => !isCancelledEarly(r))
    const successes = scored.filter((r) => r.status === "succeeded").length

    return {
      periodStart: period.from,
      periodEnd: period.to,
      runsStarted,
      finishedTasks: finishedCosts.length,
      successRateFirstTry: safeRate(successes, scored.length),
      medianCostPerFinishedTaskCents: medianRaw === null ? null : Math.round(medianRaw),
    }
  }
}
