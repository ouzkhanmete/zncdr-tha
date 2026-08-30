/** docs/api.md section 6 -- the engineer screen's three calls. None of them take a `team` filter
 *  or compare anyone to a teammate, on purpose (docs/product-brief.md). */

import {
  EngineerIdParam,
  EngineerOverviewQuery,
  EngineerOverviewResponse,
  EngineerRunsQuery,
  EngineerRunsResponse,
  EngineerTrendQuery,
  EngineerTrendResponse,
} from "@app/shared"
import type { BunRequest } from "bun"
import type { EngineerRepository } from "../../repositories/engineers.ts"
import type { EngineerService } from "../../services/engineer.ts"
import type { RunQueryService } from "../../services/run-query.ts"
import type { TrendService } from "../../services/trend.ts"
import { resolveEngineerId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { runSummaryWire } from "../shapes.ts"
import { firstIssueMessage } from "../zod.ts"

export function getEngineerOverview(engineerService: EngineerService, engineers: EngineerRepository, orgId: number) {
  return (req: BunRequest<"/api/engineers/:engineerId/overview">): Response => {
    const params = EngineerIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))
    const query = EngineerOverviewQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const engineerId = resolveEngineerId(engineers, orgId, params.data.engineerId)
    if (engineerId === undefined) return notFound("No engineer matches that id.")

    const result = engineerService.getOverview({
      orgId,
      engineerId,
      from: query.data.from,
      to: query.data.to,
      agentKind: query.data.agentKind,
    })

    return jsonReply(
      200,
      EngineerOverviewResponse.parse({
        engineerId: params.data.engineerId,
        from: query.data.from,
        to: query.data.to,
        finishedTasks: result.finishedTasks,
        successRate: result.successRate,
        // Same "nothing finished yet" null -> 0 fallback the org/team cost endpoint uses.
        costPerFinishedTask: {
          medianCents: result.costPerFinishedTask.medianCents ?? 0,
          averageCents: result.costPerFinishedTask.averageCents ?? 0,
          worstCents: result.costPerFinishedTask.worstCents ?? 0,
        },
        outputs: result.outputs,
        mergedPullRequests: result.mergedPullRequests,
        quietFailures: result.quietFailures,
        depthOfUse: result.depthOfUse,
      }),
    )
  }
}

export function getEngineerTrend(trend: TrendService, engineers: EngineerRepository, orgId: number) {
  return (req: BunRequest<"/api/engineers/:engineerId/trend">): Response => {
    const params = EngineerIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))
    const query = EngineerTrendQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const engineerId = resolveEngineerId(engineers, orgId, params.data.engineerId)
    if (engineerId === undefined) return notFound("No engineer matches that id.")

    const result = trend.getTrend({
      orgId,
      from: query.data.from,
      to: query.data.to,
      interval: query.data.interval,
      filters: { engineerId, agentKind: query.data.agentKind },
    })
    return jsonReply(200, EngineerTrendResponse.parse(result))
  }
}

export function getEngineerRuns(runQuery: RunQueryService, engineers: EngineerRepository, orgId: number) {
  return (req: BunRequest<"/api/engineers/:engineerId/runs">): Response => {
    const params = EngineerIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))
    const query = EngineerRunsQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const engineerId = resolveEngineerId(engineers, orgId, params.data.engineerId)
    if (engineerId === undefined) return notFound("No engineer matches that id.")

    const result = runQuery.search({
      orgId,
      window: { from: query.data.from, to: query.data.to },
      filters: { engineerId, status: query.data.status, agentKind: query.data.agentKind },
      limit: query.data.limit,
      offset: query.data.offset,
    })

    return jsonReply(
      200,
      EngineerRunsResponse.parse({
        items: result.items.map((r) => {
          // teamId/engineerId are dropped here -- the whole list is already this one engineer's,
          // per docs/api.md's own note under `GET /api/engineers/:engineerId/runs`.
          const { teamId: _teamId, engineerId: _engineerId, ...rest } = runSummaryWire(r)
          return rest
        }),
        total: result.total,
        limit: query.data.limit,
        offset: query.data.offset,
      }),
    )
  }
}
