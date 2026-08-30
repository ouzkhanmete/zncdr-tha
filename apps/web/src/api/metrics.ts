/** docs/api.md section 4 -- the org/team screens' eight metrics calls. Both screens call every
 *  one of these the same way; the team page just always sends `team`. */

import {
  AdoptionResponse,
  CostResponse,
  FlagsSummaryResponse,
  InProgressResponse,
  OutcomesResponse,
  ReliabilityResponse,
  SpeedResponse,
  SummaryResponse,
} from "@app/shared"
import { apiGet } from "./client.ts"

/** The three filters almost every metrics call takes -- mirrors `RangeFilter` in packages/shared. */
export type RangeParams = { team?: string; from?: string; to?: string; agentKind?: string }

/** Adoption and in-progress take no date range at all -- see docs/api.md section 4. */
export type ScopeParams = { team?: string; agentKind?: string }

export function getSummary(params: RangeParams = {}) {
  return apiGet("/metrics/summary", SummaryResponse, params)
}

/** Fixed rolling 7d/30d windows -- ignores any `from`/`to` a caller might pass. */
export function getAdoption(params: ScopeParams = {}) {
  return apiGet("/metrics/adoption", AdoptionResponse, params)
}

export function getOutcomes(params: RangeParams = {}) {
  return apiGet("/metrics/outcomes", OutcomesResponse, params)
}

export function getCost(params: RangeParams = {}) {
  return apiGet("/metrics/cost", CostResponse, params)
}

export function getReliability(params: RangeParams = {}) {
  return apiGet("/metrics/reliability", ReliabilityResponse, params)
}

export function getSpeed(params: RangeParams = {}) {
  return apiGet("/metrics/speed", SpeedResponse, params)
}

export function getFlagsSummary(params: RangeParams = {}) {
  return apiGet("/metrics/flags", FlagsSummaryResponse, params)
}

/** No date range -- this is what's happening right now, not a window. */
export function getInProgress(params: ScopeParams = {}) {
  return apiGet("/metrics/in-progress", InProgressResponse, params)
}
