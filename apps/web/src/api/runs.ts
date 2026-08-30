/** docs/api.md section 7 -- run search, and the full run detail. */

import { RunDetailResponse, RunsResponse, type Blame, type RunStatus } from "@app/shared"
import { apiGet } from "./client.ts"

export type RunSearchParams = {
  team?: string
  from?: string
  to?: string
  agentKind?: string
  engineer?: string
  status?: RunStatus
  blame?: Blame
  limit?: number
  offset?: number
}

export function searchRuns(params: RunSearchParams = {}) {
  return apiGet("/runs", RunsResponse, params)
}

export function getRunDetail(runId: string) {
  return apiGet(`/runs/${encodeURIComponent(runId)}`, RunDetailResponse)
}
