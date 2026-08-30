/** docs/api.md section 3 -- the small lookup calls that fill in the filter bar. */

import { FilterOptionsQuery, FilterOptionsResponse, TeamListResponse } from "@app/shared"
import type { TeamRepository } from "../../repositories/teams.ts"
import type { LookupService } from "../../services/lookup.ts"
import { resolveOptionalTeamId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { firstIssueMessage } from "../zod.ts"

export function getFilterOptions(lookup: LookupService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const url = new URL(req.url)
    const query = FilterOptionsQuery.safeParse(Object.fromEntries(url.searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const options = lookup.getFilterOptions(orgId, resolved.teamId)
    return jsonReply(
      200,
      FilterOptionsResponse.parse({
        teams: options.teams.map((t) => ({ id: String(t.id), name: t.name })),
        agentKinds: options.agentKinds,
        engineers: options.engineers.map((e) => ({ id: String(e.id), name: e.name })),
      }),
    )
  }
}

export function listTeams(lookup: LookupService, orgId: number) {
  return (): Response => {
    const body = lookup.listTeams(orgId).map((t) => ({ id: String(t.id), name: t.name }))
    return jsonReply(200, TeamListResponse.parse(body))
  }
}
