/**
 * `GET /api/teams/:teamId/comparison` and `GET /api/teams/comparison` -- docs/api.md section 5's
 * "teams, compared fairly." Neither call needed new repository work (see that section's own
 * note): `RunRepository.listEndedRuns` / `listTaskOutcomesStartedIn` already generalize to "every
 * team" by simply leaving `teamId` out of the filter, so this fetches once per team (or once
 * org-wide) and lets the repository do its usual chain-collapsing and filtering -- same
 * "repository groups, service does the arithmetic" split as every other metric
 * (docs/decisions.md entry 10).
 *
 * The band: docs/metrics.md's "Comparing teams of different sizes" and its own worked test in
 * docs/testing.md leave the exact formula up to the service (see that file's `ponytail:` note --
 * "Wilson score interval and a simple normal approximation are both fine at our row counts"), but
 * pin down what it has to mean: "the range you'd expect from luck alone, given how many runs this
 * team has done" is a band **around the org's own rate**, sized by the team's own sample size --
 * not a band built from the team's rate and then trivially always containing it. A team is
 * flagged when its *observed* rate falls outside that range, which only happens when the gap from
 * the org is bigger than the team's own run count can explain away as noise.
 */

import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"
import type { DateWindow } from "../repositories/types.ts"
import { isCancelledEarly } from "./trend.ts"

/** The exact sentence docs/metrics.md prints under this chart -- see docs/api.md's
 *  `GET /api/teams/:teamId/comparison`: "worded exactly as docs/metrics.md." */
export const COMPARISON_BAND_NOTE =
  "the band is the range you'd expect from luck alone, given how many runs this team has done."

const Z_95 = 1.96

export type ComparisonMetric = "firstTry" | "eventual"

export interface RateAndCount {
  rate: number
  runCount: number
}

export interface Band {
  low: number
  high: number
}

export interface TeamComparisonResult {
  metric: ComparisonMetric
  team: RateAndCount
  org: RateAndCount
  band: Band
  withinBand: boolean
  note: string
}

export interface TeamsComparisonPoint {
  teamId: number
  teamName: string
  rate: number
  runCount: number
  band: Band
  withinBand: boolean
}

export interface TeamsComparisonResult {
  metric: ComparisonMetric
  from: string
  to: string
  org: RateAndCount
  teams: TeamsComparisonPoint[]
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/** A normal-approximation band around `centerRate`, sized to `runCount` -- the "range you'd
 *  expect from luck alone" if a team's true rate actually equalled the org's. Zero runs has
 *  nothing to bound, so it comes back as the widest possible band rather than a division by
 *  zero. */
function bandAround(centerRate: number, runCount: number): Band {
  if (runCount === 0) return { low: 0, high: 1 }
  const standardError = Math.sqrt((centerRate * (1 - centerRate)) / runCount)
  const margin = Z_95 * standardError
  return { low: Math.max(0, centerRate - margin), high: Math.min(1, centerRate + margin) }
}

function withinBand(rate: number, band: Band): boolean {
  return rate >= band.low && rate <= band.high
}

export class ComparisonService {
  constructor(
    private readonly runs: RunRepository,
    private readonly teams: TeamRepository,
  ) {}

  getTeamComparison(
    orgId: number,
    teamId: number,
    window: DateWindow,
    metric: ComparisonMetric,
    agentKind?: string,
  ): TeamComparisonResult {
    const org = this.rateAndCount(orgId, window, metric, { agentKind })
    const team = this.rateAndCount(orgId, window, metric, { teamId, agentKind })
    const band = bandAround(org.rate, team.runCount)
    return { metric, team, org, band, withinBand: withinBand(team.rate, band), note: COMPARISON_BAND_NOTE }
  }

  getTeamsComparison(
    orgId: number,
    window: DateWindow,
    metric: ComparisonMetric,
    agentKind?: string,
  ): TeamsComparisonResult {
    const org = this.rateAndCount(orgId, window, metric, { agentKind })
    const teams = this.teams.listByOrgId(orgId).map((t) => {
      const { rate, runCount } = this.rateAndCount(orgId, window, metric, { teamId: t.id, agentKind })
      const band = bandAround(org.rate, runCount)
      return { teamId: t.id, teamName: t.name, rate, runCount, band, withinBand: withinBand(rate, band) }
    })
    return { metric, from: window.from, to: window.to, org, teams }
  }

  private rateAndCount(orgId: number, window: DateWindow, metric: ComparisonMetric, filters: RunFilters): RateAndCount {
    if (metric === "firstTry") {
      const scored = this.runs.listEndedRuns(orgId, window, filters).filter((r) => !isCancelledEarly(r))
      const successes = scored.filter((r) => r.status === "succeeded").length
      return { rate: safeRate(successes, scored.length), runCount: scored.length }
    }

    let succeededTasks = 0
    let totalTasks = 0
    for (const { runs } of this.runs.listTaskOutcomesStartedIn(orgId, window, filters)) {
      const scored = runs.filter((r) => !isCancelledEarly(r))
      if (scored.length === 0) continue
      totalTasks++
      if (scored.some((r) => r.status === "succeeded")) succeededTasks++
    }
    return { rate: safeRate(succeededTasks, totalTasks), runCount: totalTasks }
  }
}
