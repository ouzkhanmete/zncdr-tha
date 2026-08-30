/**
 * The one write in the whole API -- `PUT /api/teams/:teamId/budget`. docs/api.md section 9's
 * worked example shows a controller catching an `InvalidBudgetError` thrown by a service method
 * named `setBudget`; this is that service. It lives apart from the read-side
 * `services/budget.ts` (already built for `GET /api/budget-status` and friends) rather than
 * adding to that file -- docs/plan.md's own Step 6 brief calls out "the budget write path with
 * its validation" as this step's work, not Step 5's.
 *
 * The two rules enforced here are the same two `@app/shared`'s `BudgetInput` Zod schema already
 * checks at parse time (packages/shared/src/api.ts). This is the second line of defence
 * docs/api.md describes -- "the rule lives in both places on purpose: the API explains, the table
 * guarantees" -- not the only one; the controller is what actually routes a shared-schema failure
 * on these two specific rules to `422 invalid_budget` instead of `400 bad_request`, since Zod
 * itself doesn't know the difference between "malformed" and "a business rule caught it."
 */

import type { Budget } from "@app/shared"
import type { BudgetRepository } from "../repositories/budgets.ts"

export interface BudgetInputData {
  month: string
  limitCents: number
  warnCents: number
  stopCents: number
}

export class InvalidBudgetError extends Error {
  readonly details: Record<string, string>

  constructor(message: string, details: Record<string, string>) {
    super(message)
    this.name = "InvalidBudgetError"
    this.details = details
  }
}

export class BudgetWriteService {
  constructor(private readonly budgets: BudgetRepository) {}

  /** The raw setting for one team and month, for prefilling the edit form -- docs/api.md's
   *  `GET /api/teams/:teamId/budget`. `undefined` when nobody has set one yet; the controller
   *  turns that into the 404 that endpoint documents. Grouped here rather than in the read-side
   *  `services/budget.ts` because it serves the same edit form this file's `setBudget` writes
   *  back to, not the burn-state screens that file's other methods build. */
  getRawBudget(teamId: number, month: string): Budget | undefined {
    return this.budgets.findByTeamAndMonth(teamId, month)
  }

  /** Creates the budget if this team has none for that month yet, otherwise replaces it --
   *  docs/api.md's `PUT /api/teams/:teamId/budget`. */
  setBudget(teamId: number, input: BudgetInputData, nowIso: string): Budget {
    // Checked in this order on purpose: a stop line above the limit is caught first, so a value
    // that breaks both rules at once still gets the one docs/api.md's error table lists first.
    if (input.stopCents > input.limitCents) {
      throw new InvalidBudgetError("The stop line cannot sit above the limit.", {
        stopCents: `${input.stopCents} is above limitCents (${input.limitCents})`,
      })
    }
    if (input.warnCents >= input.stopCents) {
      throw new InvalidBudgetError("The warning line has to sit below the stop line.", {
        warnCents: `${input.warnCents} is not less than stopCents (${input.stopCents})`,
      })
    }
    return this.budgets.upsert({ teamId, ...input, updatedAt: nowIso })
  }
}
