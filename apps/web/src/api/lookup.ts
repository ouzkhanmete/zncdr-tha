/** docs/api.md section 3 -- the small lookup calls that fill in the filter bar and the team
 *  roster. */

import { FilterOptionsResponse, TeamListResponse } from "@app/shared"
import { apiGet } from "./client.ts"

export function getFilterOptions(team?: string) {
  return apiGet("/filter-options", FilterOptionsResponse, { team })
}

export function getTeams() {
  return apiGet("/teams", TeamListResponse)
}
