/** `GET /api/flags` -- docs/api.md section 4's paged, filterable flag list. */

import { FlagListQuery, FlagListResponse } from "@app/shared"
import type { TeamRepository } from "../../repositories/teams.ts"
import type { RulesService } from "../../services/rules.ts"
import { resolveOptionalTeamId } from "../ids.ts"
import { badRequest, jsonReply, notFound } from "../respond.ts"
import { firstIssueMessage } from "../zod.ts"

export function listFlags(rules: RulesService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = FlagListQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const page = rules.listRanked({
      orgId,
      from: query.data.from,
      to: query.data.to,
      filters: { teamId: resolved.teamId, agentKind: query.data.agentKind },
      severity: query.data.severity,
      status: query.data.status,
      kind: query.data.kind,
      limit: query.data.limit,
      offset: query.data.offset,
    })

    return jsonReply(
      200,
      FlagListResponse.parse({
        items: page.items.map((f) => ({
          id: String(f.id),
          runId: String(f.runId),
          kind: f.kind,
          severity: f.severity,
          status: f.disposition,
          isNewKindForScope: f.isNewKindForScope,
          createdAt: f.createdAt,
          teamId: String(f.teamId),
          teamName: f.teamName,
        })),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      }),
    )
  }
}
