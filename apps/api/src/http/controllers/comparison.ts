/**
 * `GET /api/teams/:teamId/comparison` and `GET /api/teams/comparison` -- docs/api.md section 5.
 * The literal `/api/teams/comparison` path always matches ahead of the `:teamId` wildcard (Bun's
 * router does exact-before-parameter matching on its own -- see docs/api.md's own routing note),
 * so both are wired up in `index.ts` with no special ordering trick needed here.
 */

import { ComparisonQuery, ComparisonResponse, TeamIdParam, TeamsComparisonQuery, TeamsComparisonResponse } from "@app/shared"
import type { BunRequest } from "bun"
import type { TeamRepository } from "../../repositories/teams.ts"
import type { ComparisonService } from "../../services/comparison.ts"
import { resolveRequiredTeamId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { firstIssueMessage } from "../zod.ts"

export function getTeamComparison(comparison: ComparisonService, teams: TeamRepository, orgId: number) {
  return (req: BunRequest<"/api/teams/:teamId/comparison">): Response => {
    const params = TeamIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))
    const query = ComparisonQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const teamId = resolveRequiredTeamId(teams, orgId, params.data.teamId)
    if (teamId === undefined) return notFound("No team matches that id.")

    const result = comparison.getTeamComparison(
      orgId,
      teamId,
      { from: query.data.from, to: query.data.to },
      query.data.metric,
      query.data.agentKind,
    )
    return jsonReply(
      200,
      ComparisonResponse.parse({
        metric: result.metric,
        team: result.team,
        org: result.org,
        band: result.band,
        withinBand: result.withinBand,
        note: result.note,
      }),
    )
  }
}

export function getTeamsComparison(comparison: ComparisonService, orgId: number) {
  return (req: Request): Response => {
    const query = TeamsComparisonQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const result = comparison.getTeamsComparison(
      orgId,
      { from: query.data.from, to: query.data.to },
      query.data.metric,
      query.data.agentKind,
    )
    return jsonReply(
      200,
      TeamsComparisonResponse.parse({
        metric: result.metric,
        from: result.from,
        to: result.to,
        org: result.org,
        teams: result.teams.map((t) => ({
          teamId: String(t.teamId),
          teamName: t.teamName,
          rate: t.rate,
          runCount: t.runCount,
          band: t.band,
          withinBand: t.withinBand,
        })),
      }),
    )
  }
}
