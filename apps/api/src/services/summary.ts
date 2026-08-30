/**
 * The hero number's raw pieces -- `GET /api/metrics/summary`. See docs/product-brief.md's "The
 * one number" and docs/decisions.md entry 1: the server hands back `finishedTasks`,
 * `moneySpentCents`, and its own defaults for the two viewer-editable dials, and the browser does
 * the actual multiplying live as the dials move -- no round trip needed for that part. This
 * service exists only to assemble those raw pieces from the repositories that already hold them,
 * with no service in `docs/plan.md`'s Step 5 split owning this one specific shape.
 */

import { sumCents } from "@app/shared"
import type { SummaryResponse } from "@app/shared"
import type { RunRepository } from "../repositories/runs.ts"
import type { DateWindow, ScopeFilters } from "../repositories/types.ts"
import type { CostService } from "./cost.ts"

/**
 * The server's own starting guesses for the two dials a viewer can turn -- see
 * apps/web/src/pages/OrgPage.tsx and apps/web/src/lib/hero.test.ts, which already assume exactly
 * these two figures ($85/hr, one hour saved per finished task) as the sample-data stand-in for
 * what the real API sends.
 */
const HERO_DEFAULTS = { hoursSavedPerTask: 1.0, engineerHourlyCostCents: 8_500 }

export interface SummaryQuery {
  orgId: number
  from: string
  to: string
  filters?: ScopeFilters
}

export class SummaryService {
  constructor(
    private readonly runs: RunRepository,
    private readonly cost: CostService,
  ) {}

  getSummary(query: SummaryQuery): SummaryResponse {
    const { orgId, from, to, filters } = query
    const window: DateWindow = { from, to }

    // Finished tasks reuses the exact same task-chain collapse CostService's own headline number
    // is built from, so the two never quietly disagree about what counts as "finished."
    const finishedTasks = this.cost.costPerFinishedTask(orgId, window, filters).perFinishedTask.taskCount

    // "Every run in the window, failed runs included" -- docs/api.md's `moneySpentCents`. Not
    // filtered to finished runs at all, unlike `finishedTasks` above:
    // `RunRepository.listDailyCostTotals` sums every run's cost by the UTC day it *started* on,
    // with no status filter, the same building block the budget burn chart sums for spend.
    const moneySpentCents = sumCents(this.runs.listDailyCostTotals(orgId, window, filters).map((d) => d.costCents))

    return { from, to, finishedTasks, moneySpentCents, defaults: HERO_DEFAULTS }
  }
}
