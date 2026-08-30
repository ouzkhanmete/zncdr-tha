/** docs/api.md section 6 -- the engineer screen's three calls. None of them take a `team` filter
 *  or return anyone to compare against, on purpose (docs/product-brief.md). */

import { EngineerOverviewResponse, EngineerRunsResponse, EngineerTrendResponse, type RunStatus } from "@app/shared"
import { apiGet } from "./client.ts"

export function getEngineerOverview(engineerId: string, params: { from?: string; to?: string; agentKind?: string } = {}) {
  return apiGet(`/engineers/${encodeURIComponent(engineerId)}/overview`, EngineerOverviewResponse, params)
}

export function getEngineerTrend(
  engineerId: string,
  params: { from?: string; to?: string; interval?: "day" | "week"; agentKind?: string } = {},
) {
  return apiGet(`/engineers/${encodeURIComponent(engineerId)}/trend`, EngineerTrendResponse, params)
}

export function getEngineerRuns(
  engineerId: string,
  params: { from?: string; to?: string; status?: RunStatus; agentKind?: string; limit?: number; offset?: number } = {},
) {
  return apiGet(`/engineers/${encodeURIComponent(engineerId)}/runs`, EngineerRunsResponse, params)
}
