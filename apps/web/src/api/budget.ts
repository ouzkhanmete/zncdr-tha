/** docs/api.md section 5 -- budget status (org and team), the raw setting, and the one write in
 *  the whole API. */

import type { BudgetInput } from "@app/shared"
import { BudgetResponse, BudgetStatusResponse, TeamBudgetResponse } from "@app/shared"
import { apiGet, apiPut, isNotFound } from "./client.ts"

export function getBudgetStatus(params: { team?: string; month?: string } = {}) {
  return apiGet("/budget-status", BudgetStatusResponse, params)
}

/**
 * Same call as `getBudgetStatus`, but a team with no budget set for the month comes back as a
 * plain `null` instead of a thrown 404 -- the org page's per-team budget table (docs/ui.md) needs
 * to tell "this team hasn't set a budget yet" apart from "the budget section failed to load",
 * and only one of those two is really an error.
 */
export async function getBudgetStatusOrNull(params: { team?: string; month?: string } = {}) {
  try {
    return await getBudgetStatus(params)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export function getTeamBudget(teamId: string, month?: string) {
  return apiGet(`/teams/${encodeURIComponent(teamId)}/budget`, TeamBudgetResponse, { month })
}

export async function getTeamBudgetOrNull(teamId: string, month?: string) {
  try {
    return await getTeamBudget(teamId, month)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export function putTeamBudget(teamId: string, body: BudgetInput) {
  return apiPut(`/teams/${encodeURIComponent(teamId)}/budget`, body, BudgetResponse)
}
