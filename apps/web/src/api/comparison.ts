/** docs/api.md section 5 -- one team against the org, and every team against the org at once. */

import { ComparisonResponse, TeamsComparisonResponse } from "@app/shared"
import { apiGet } from "./client.ts"

export type ComparisonParams = { metric?: "firstTry" | "eventual"; from?: string; to?: string; agentKind?: string }

export function getTeamComparison(teamId: string, params: ComparisonParams = {}) {
  return apiGet(`/teams/${encodeURIComponent(teamId)}/comparison`, ComparisonResponse, params)
}

export function getTeamsComparison(params: ComparisonParams = {}) {
  return apiGet("/teams/comparison", TeamsComparisonResponse, params)
}
