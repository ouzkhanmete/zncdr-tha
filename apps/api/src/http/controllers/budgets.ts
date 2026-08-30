/**
 * docs/api.md section 5 -- budget status (org and team), the raw setting, and the one write in
 * the whole API.
 */

import { BudgetInput, BudgetResponse, BudgetStatusQuery, BudgetStatusResponse, TeamBudgetQuery, TeamIdParam } from "@app/shared"
import type { BunRequest } from "bun"
import type { TeamRepository } from "../../repositories/teams.ts"
import { BudgetWriteService, InvalidBudgetError } from "../../services/budget-write.ts"
import type { BudgetService } from "../../services/budget.ts"
import { resolveOptionalTeamId, resolveRequiredTeamId } from "../ids.ts"
import { badRequest, errorReply, jsonReply, notFound } from "../respond.ts"
import { firstIssueMessage } from "../zod.ts"

export function getBudgetStatus(budgets: BudgetService, teams: TeamRepository, orgId: number) {
  return (req: Request): Response => {
    const query = BudgetStatusQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))
    const resolved = resolveOptionalTeamId(teams, orgId, query.data.team)
    if (!resolved.found) return notFound("No team matches that id.")

    const now = new Date().toISOString()

    if (resolved.teamId === undefined) {
      const result = budgets.getOrgBudgetStatus(orgId, query.data.month, now)
      return jsonReply(
        200,
        BudgetStatusResponse.parse({
          scope: "org",
          teamId: null,
          month: result.month,
          limitCents: result.limitCents,
          warnCents: result.warnCents,
          stopCents: result.stopCents,
          spentSoFarCents: result.spentSoFarCents,
          monthProgress: result.monthProgress,
          projectedLandingCents: result.projectedLandingCents,
          warnLineCrossed: result.warnLineCrossed,
          stopLineCrossed: result.stopLineCrossed,
          teamsWithoutBudget: result.teamsWithoutBudget,
          dailySpend: result.dailySpend,
        }),
      )
    }

    const result = budgets.getTeamBudgetStatus(orgId, resolved.teamId, query.data.month, now)
    if (!result) return notFound("No budget has been set for that team and month yet.")
    return jsonReply(
      200,
      BudgetStatusResponse.parse({
        scope: "team",
        teamId: String(result.teamId),
        month: result.month,
        limitCents: result.limitCents,
        warnCents: result.warnCents,
        stopCents: result.stopCents,
        spentSoFarCents: result.spentSoFarCents,
        monthProgress: result.monthProgress,
        projectedLandingCents: result.projectedLandingCents,
        warnLineCrossed: result.warnLineCrossed,
        stopLineCrossed: result.stopLineCrossed,
        dailySpend: result.dailySpend,
      }),
    )
  }
}

export function getTeamBudget(budgetWrite: BudgetWriteService, teams: TeamRepository, orgId: number) {
  return (req: BunRequest<"/api/teams/:teamId/budget">): Response => {
    const params = TeamIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))
    const query = TeamBudgetQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return badRequest(firstIssueMessage(query.error))

    const teamId = resolveRequiredTeamId(teams, orgId, params.data.teamId)
    if (teamId === undefined) return notFound("No team matches that id.")

    const budget = budgetWrite.getRawBudget(teamId, query.data.month)
    if (!budget) return notFound("No budget has been set for that team and month yet.")

    return jsonReply(
      200,
      BudgetResponse.parse({
        teamId: params.data.teamId,
        month: budget.month,
        limitCents: budget.limitCents,
        warnCents: budget.warnCents,
        stopCents: budget.stopCents,
      }),
    )
  }
}

export function putTeamBudget(budgetWrite: BudgetWriteService, teams: TeamRepository, orgId: number) {
  return async (req: BunRequest<"/api/teams/:teamId/budget">): Promise<Response> => {
    const params = TeamIdParam.safeParse(req.params)
    if (!params.success) return badRequest(firstIssueMessage(params.error))

    const teamId = resolveRequiredTeamId(teams, orgId, params.data.teamId)
    if (teamId === undefined) return notFound("No team matches that id.")

    let json: unknown
    try {
      json = await req.json()
    } catch {
      return badRequest("The request body must be valid JSON.")
    }

    const body = BudgetInput.safeParse(json)
    if (!body.success) {
      // `@app/shared`'s `BudgetInput` schema bakes docs/api.md's two budget rules into its own
      // `.refine()` checks -- not just a shape check. A Zod object schema only runs its
      // refinements once the base shape has already parsed successfully, so a failure made
      // *only* of `custom`-coded issues can only mean one (or both) of those two rules fired;
      // any other issue code means the shape itself was wrong. That's how a 400 (malformed) is
      // told apart from the 422 `invalid_budget` docs/api.md's error table reserves for exactly
      // these two rules.
      const isBusinessRuleFailure = body.error.issues.length > 0 && body.error.issues.every((issue) => issue.code === "custom")
      if (isBusinessRuleFailure) {
        // The base shape already parsed (that's what makes every issue here `custom`), so the
        // three numbers below are known to be there -- reading them off the raw body lets the
        // `details` value name the actual figures involved, matching docs/api.md section 8's own
        // worked example ("8000000 is not less than stopCents (5000000)"), not just repeat the
        // rule's sentence a second time.
        const raw = json as { limitCents: number; warnCents: number; stopCents: number }
        const details: Record<string, string> = {}
        for (const issue of body.error.issues) {
          const field = String(issue.path[0] ?? "budget")
          if (field === "warnCents") details.warnCents = `${raw.warnCents} is not less than stopCents (${raw.stopCents})`
          else if (field === "stopCents") details.stopCents = `${raw.stopCents} is above limitCents (${raw.limitCents})`
          else details[field] = issue.message
        }
        return errorReply(422, "invalid_budget", body.error.issues[0]!.message, details)
      }
      return badRequest(firstIssueMessage(body.error))
    }

    try {
      const saved = budgetWrite.setBudget(teamId, body.data, new Date().toISOString())
      return jsonReply(
        200,
        BudgetResponse.parse({
          teamId: params.data.teamId,
          month: saved.month,
          limitCents: saved.limitCents,
          warnCents: saved.warnCents,
          stopCents: saved.stopCents,
        }),
      )
    } catch (err) {
      // Defence in depth (docs/api.md: "the rule lives in both places on purpose") -- by the time
      // `BudgetInput` above has already passed, this should never actually fire.
      if (err instanceof InvalidBudgetError) return errorReply(422, "invalid_budget", err.message, err.details)
      throw err
    }
  }
}
