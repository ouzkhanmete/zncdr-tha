/** `GET /api/flags` -- docs/api.md section 4's paged, filterable flag list. */

import type { Disposition, PolicyFlagKind, Severity } from "@app/shared"
import { FlagListResponse } from "@app/shared"
import { apiGet } from "./client.ts"

export type FlagListParams = {
  team?: string
  from?: string
  to?: string
  agentKind?: string
  severity?: Severity
  status?: Disposition
  kind?: PolicyFlagKind
  limit?: number
  offset?: number
}

export function listFlags(params: FlagListParams = {}) {
  return apiGet("/flags", FlagListResponse, params)
}
