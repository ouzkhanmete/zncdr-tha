/** `GET /api/trend` -- docs/api.md section 4, the org/team trend line. */

import { TrendResponse } from "@app/shared"
import { apiGet } from "./client.ts"

export type TrendParams = { team?: string; from?: string; to?: string; interval?: "day" | "week"; agentKind?: string }

export function getTrend(params: TrendParams = {}) {
  return apiGet("/trend", TrendResponse, params)
}
