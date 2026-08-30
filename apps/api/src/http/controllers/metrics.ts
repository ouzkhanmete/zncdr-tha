/**
 * docs/api.md section 4 -- the org/team screens' metrics calls, plus `/api/metrics/flags` and
 * `/api/metrics/in-progress` from the same section. Every handler here does the same three
 * things: parse the query with a `@app/shared` schema, resolve an optional `team` id, call one
 * service, shape the reply.
 */

import {
  AdoptionQuery,
  AdoptionResponse,
  CostResponse,
  FlagsSummaryResponse,
  InProgressQuery,
  InProgressResponse,
  OutcomesResponse,
  ReliabilityResponse,
  SpeedResponse,
  SummaryResponse,
  rangeFilter,
} from "@app/shared"
import type { TeamRepository } from "../../repositories/teams.ts"
import type { AdoptionService } from "../../services/adoption.ts"
import type { CostService } from "../../services/cost.ts"
import type { OutcomeService } from "../../services/outcome.ts"
import type { ReliabilityService } from "../../services/reliability.ts"
import type { RulesService } from "../../services/rules.ts"
import type { SpeedService } from "../../services/speed.ts"
import type { SummaryService } from "../../services/summary.ts"
import { resolveOptionalTeamId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { firstIssueMessage } from "../zod.ts"

export function getSummary(summary: SummaryService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = rangeFilter.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = summary.getSummary({
      orgId,
      from: query.data.from,
      to: query.data.to,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })
    return jsonReply(200, SummaryResponse.parse(result))
  }
}

export function getAdoption(adoption: AdoptionService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = AdoptionQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = adoption.getAdoptionMetrics({
      orgId,
      now: new Date().toISOString(),
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })
    return jsonReply(200, AdoptionResponse.parse(result))
  }
}

export function getOutcomes(outcome: OutcomeService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = rangeFilter.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = outcome.getOutcomes({
      orgId,
      from: query.data.from,
      to: query.data.to,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })
    return jsonReply(200, OutcomesResponse.parse(result))
  }
}

export function getCost(cost: CostService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = rangeFilter.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const { from, to } = query.data
    const window = { from, to }
    const filters = { teamId: resolved.teamId, agentKind: query.data.agentKind }
    const perTask = cost.costPerFinishedTask(orgId, window, filters)
    const tokensUsed = cost.tokensUsed(orgId, window, filters)

    return jsonReply(
      200,
      CostResponse.parse({
        from,
        to,
        // A run repository's "no finished tasks yet" comes back as `null` from `stats.ts`
        // (`median`/percentile functions never invent a zero out of nothing); the wire schema
        // has no such window, so an empty period reports zeroes here instead.
        costPerFinishedTask: {
          medianCents: perTask.perFinishedTask.medianCents ?? 0,
          averageCents: perTask.perFinishedTask.averageCents ?? 0,
          worstCents: perTask.perFinishedTask.worstCents ?? 0,
          finishedTasks: perTask.perFinishedTask.taskCount,
        },
        tokensUsed,
      }),
    )
  }
}

export function getReliability(reliability: ReliabilityService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = rangeFilter.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = reliability.getReliability({
      orgId,
      from: query.data.from,
      to: query.data.to,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })

    // Every cancelled run, whenever it was stopped -- not the narrower `cancelledEarly` that
    // SuccessRateWindow uses, which means "stopped in the first few seconds, before the agent did
    // anything". Two different counts, so two different names on purpose.
    const failureWindow = (w: (typeof result)["failureRate"]["last7d"]) => ({
      endedRuns: w.endedRuns,
      cancelled: w.cancelled,
      byBlame: w.byBlame,
      byCause: w.byCause,
    })

    return jsonReply(
      200,
      ReliabilityResponse.parse({
        failureRate: {
          last7d: failureWindow(result.failureRate.last7d),
          last30d: failureWindow(result.failureRate.last30d),
        },
        from: result.from,
        to: result.to,
        quietFailures: result.quietFailures,
        retryRate: result.retryRate,
        // Same "nothing happened yet" null -> 0 fallback as `getCost` above: no failing run in
        // the window means no percentile to report, and the wire schema has no null for it.
        timeBeforeGivingUp: {
          p50Ms: result.timeBeforeGivingUp.p50Ms ?? 0,
          p95Ms: result.timeBeforeGivingUp.p95Ms ?? 0,
        },
      }),
    )
  }
}

export function getSpeed(speed: SpeedService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = rangeFilter.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = speed.getSpeed({
      orgId,
      from: query.data.from,
      to: query.data.to,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })

    const zeroed = (p: { p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }) => ({
      p50Ms: p.p50Ms ?? 0,
      p95Ms: p.p95Ms ?? 0,
      p99Ms: p.p99Ms ?? 0,
    })

    return jsonReply(
      200,
      SpeedResponse.parse({
        from: result.from,
        to: result.to,
        turnTime: zeroed(result.turnTime),
        runTime: zeroed(result.runTime),
        timedOutRuns: result.timedOutRuns,
      }),
    )
  }
}

export function getFlagsSummary(rules: RulesService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = rangeFilter.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = rules.getSummary({
      orgId,
      from: query.data.from,
      to: query.data.to,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })
    // `dismissedExpectedByKind` isn't part of `FlagsSummaryResponse` -- Zod drops it silently,
    // but building the reply explicitly keeps this file honest about what's actually on the wire.
    return jsonReply(
      200,
      FlagsSummaryResponse.parse({
        from: result.from,
        to: result.to,
        bySeverity: result.bySeverity,
        byStatus: result.byStatus,
        dismissedExpectedRate: result.dismissedExpectedRate,
      }),
    )
  }
}

export function getInProgress(outcome: OutcomeService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = InProgressQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = outcome.inProgress(orgId, { teamId: resolved.teamId, agentKind: query.data.agentKind })
    return jsonReply(200, InProgressResponse.parse(result))
  }
}
