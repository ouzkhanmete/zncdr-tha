/** docs/api.md section 7 -- run search, and the full run detail. */

import { RunDetailResponse, RunIdParam, RunsQuery, RunsResponse } from "@app/shared"
import type { BunRequest } from "bun"
import type { EngineerRepository } from "../../repositories/engineers.ts"
import type { TeamRepository } from "../../repositories/teams.ts"
import type { RunQueryService } from "../../services/run-query.ts"
import { parseId, resolveEngineerId, resolveOptionalTeamId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { runDetailWire, runSummaryWire } from "../shapes.ts"
import { firstIssueMessage } from "../zod.ts"

export function searchRuns(runQuery: RunQueryService, teams: TeamRepository, engineers: EngineerRepository, orgId: number) {
  return (req: Request): Response => {
    const query = RunsQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const resolvedTeam = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolvedTeam.found) return notFound("No team matches that id.")

    let engineerId: number | undefined
    if (query.data.engineer !== undefined) {
      engineerId = resolveEngineerId(engineers, orgId, query.data.engineer)
      if (engineerId === undefined) return notFound("No engineer matches that id.")
    }

    const result = runQuery.search({
      orgId,
      window: { from: query.data.from, to: query.data.to },
      filters: {
        teamId: resolvedTeam.teamId,
        agentKind: query.data.agentKind,
        engineerId,
        status: query.data.status,
        blame: query.data.blame,
      },
      limit: query.data.limit,
      offset: query.data.offset,
    })

    return jsonReply(
      200,
      RunsResponse.parse({
        items: result.items.map(runSummaryWire),
        total: result.total,
        limit: query.data.limit,
        offset: query.data.offset,
      }),
    )
  }
}

export function getRunDetail(runQuery: RunQueryService) {
  return (req: BunRequest<"/api/runs/:runId">): Response => {
    const params = RunIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))

    const id = parseId(params.data.runId)
    const detail = id === null ? undefined : runQuery.getDetail(id)
    if (!detail) return notFound("No run matches that id.")

    return jsonReply(200, RunDetailResponse.parse(runDetailWire(detail)))
  }
}
