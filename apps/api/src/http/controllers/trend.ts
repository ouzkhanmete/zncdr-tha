/** `GET /api/trend` -- docs/api.md section 4, the org/team trend line. */

import { TrendQuery, TrendResponse } from "@app/shared"
import type { TeamRepository } from "../../repositories/teams.ts"
import type { TrendService } from "../../services/trend.ts"
import { resolveOptionalTeamId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { firstIssueMessage } from "../zod.ts"

export function getTrend(trend: TrendService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = TrendQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const result = trend.getTrend({
      orgId,
      from: query.data.from,
      to: query.data.to,
      interval: query.data.interval,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
    })
    return jsonReply(200, TrendResponse.parse(result))
  }
}
