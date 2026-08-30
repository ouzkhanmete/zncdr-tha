/**
 * Group 3 — Money: cost per finished task, tokens used, and the hero money-vs-value number.
 * Every formula here matches docs/metrics.md's "Group 3 — Money" section and
 * docs/product-brief.md's "The one number" exactly. See docs/decisions.md entry 10 for why this
 * arithmetic lives here and not in SQL: a repository groups and filters rows, this is where the
 * rows turn into a median, a rate, or a dollar figure.
 *
 * Every function that returns money returns whole cents, as an integer, always -- see
 * docs/architecture.md and docs/data-model.md. Where a division can't land on a whole cent
 * (pricing a turn, averaging a set of task costs, projecting a value), the comment on that
 * function says exactly where the one rounding step happens.
 */

import { sumCents } from "@app/shared"
import type { RunFilters, RunRepository } from "../repositories/runs.ts"
import type { TurnRepository } from "../repositories/turns.ts"
import type { DateWindow, ScopeFilters } from "../repositories/types.ts"
import { median } from "./stats.ts"

// ---------------------------------------------------------------------------
// Pricing a single turn -- docs/metrics.md's "Cost of one run" formula.
// ---------------------------------------------------------------------------

/** The five token counts a turn carries, whatever their source. */
export interface TurnTokenCounts {
  tokensInFresh: number
  tokensInCached: number
  tokensCacheWrite: number
  tokensOut: number
  tokensThinking: number
}

/** The four price columns on one row of the `models` table -- the price in effect for one
 *  provider/model at one moment in time. Never look this up by "today's price"; always the row a
 *  turn actually points at (`models.findById(turn.modelId)`), so a later price change can never
 *  reach back and rewrite what an old turn cost. */
export interface ModelPrices {
  inputPricePerMtokCents: number
  cachedInputPricePerMtokCents: number
  cacheWritePricePerMtokCents: number
  outputPricePerMtokCents: number
}

/**
 * turn cost = fresh input tokens   x input price
 *           + cache write tokens   x cache write price
 *           + cache read tokens    x cached input price   (about a tenth of the fresh rate)
 *           + output tokens        x output price
 *           + thinking tokens      x output price          (its own line, same rate as output)
 *
 * Each price is its own stored figure per million tokens, never a multiplier off the input
 * price -- see docs/metrics.md. Cached and cache-write tokens are priced from their own columns,
 * never lumped into the fresh-input line at full price.
 *
 * Rounding happens exactly once, after every component is added in fractional-cent space --
 * not once per component. A whole-cent price spread over a token count rarely lands on a whole
 * cent by itself, so rounding each of the five lines separately and then adding them can drift by
 * a couple of cents from the true total; rounding the finished sum drifts by at most half a cent,
 * and only the one time.
 */
export function priceTurnCents(tokens: TurnTokenCounts, price: ModelPrices): number {
  const perToken = (pricePerMtokCents: number) => pricePerMtokCents / 1_000_000
  const cost =
    tokens.tokensInFresh * perToken(price.inputPricePerMtokCents) +
    tokens.tokensCacheWrite * perToken(price.cacheWritePricePerMtokCents) +
    tokens.tokensInCached * perToken(price.cachedInputPricePerMtokCents) +
    tokens.tokensOut * perToken(price.outputPricePerMtokCents) +
    tokens.tokensThinking * perToken(price.outputPricePerMtokCents)
  return Math.max(0, Math.round(cost))
}

/**
 * run cost = sum of every turn cost in the run + sum of every tool call cost in the run.
 *
 * Tool calls carry their own already-priced `cost_cents` -- there is no hourly rate table here on
 * purpose (see docs/metrics.md and docs/data-model.md's "Where tool time is priced"): the rate
 * belongs to whoever bills for the tool, and a copy of it here would be a second number to keep
 * in step with theirs. A free tool's call costs zero and adds nothing.
 *
 * `sumCents` does the actual adding, so this can never let a float slip in on the way through --
 * see docs/metrics.md's "money never drifts through a float" trap.
 */
export function runCostCents(turnCostsCents: readonly number[], toolCallCostsCents: readonly number[]): number {
  return sumCents([...turnCostsCents, ...toolCallCostsCents])
}

// ---------------------------------------------------------------------------
// Cost per finished task -- docs/metrics.md's "Cost per finished task".
// ---------------------------------------------------------------------------

export interface TaskCostStats {
  medianCents: number | null
  averageCents: number | null
  worstCents: number | null
  taskCount: number
}

export interface CostPerTaskResult {
  /** Every task whose chain eventually succeeded. Each figure counts the whole chain's cost --
   *  every failed attempt included -- not just the winning run. This is the number
   *  docs/metrics.md calls "cost per finished task" and the one that leads on screen. */
  perFinishedTask: TaskCostStats
  /** Every task chain that reached an end in the window, success or not -- including chains that
   *  never succeeded at all, which never appear in `perFinishedTask` because they have no
   *  "finished" moment to count from. Sits beside the headline number so a run of tasks that all
   *  failed expensively doesn't quietly vanish from the money picture just because nothing
   *  finished. Not itself a docs/metrics.md-named number; see this service's test file and the
   *  note handed back with this work for why it's reported anyway. */
  perAttemptedTask: TaskCostStats
}

function summarizeTaskCosts(costsCents: readonly number[]): TaskCostStats {
  if (costsCents.length === 0) {
    return { medianCents: null, averageCents: null, worstCents: null, taskCount: 0 }
  }
  const medianRaw = median(costsCents)
  return {
    // median() can land between two whole-cent costs (an even-sized set) -- round once, here,
    // the one place a fractional cent from the maths gets snapped to a real one.
    medianCents: medianRaw === null ? null : Math.round(medianRaw),
    averageCents: Math.round(sumCents([...costsCents]) / costsCents.length),
    worstCents: Math.max(...costsCents),
    taskCount: costsCents.length,
  }
}

// ---------------------------------------------------------------------------
// Tokens used -- reported apart from money on purpose, so "we used more" can be told apart from
// "the price changed".
// ---------------------------------------------------------------------------

export interface TokensUsed {
  freshInput: number
  cachedInput: number
  output: number
  thinking: number
}

const emptyTokensUsed: TokensUsed = { freshInput: 0, cachedInput: 0, output: 0, thinking: 0 }

// ---------------------------------------------------------------------------
// The hero number -- docs/product-brief.md's "The one number".
// ---------------------------------------------------------------------------

export interface HeroInputs {
  finishedTasks: number
  /** A dial the viewer sets, not a fact -- docs/decisions.md entry 1. */
  hoursSavedPerTask: number
  /** A dial the viewer sets, in whole cents. */
  engineerHourlyCostCents: number
  moneySpentCents: number
}

export interface HeroNumbers {
  valueReturnedCents: number
  netCents: number
}

/**
 * value returned = finished tasks x hours saved per task x cost of an engineer hour
 * net           = value returned - money spent
 *
 * Per docs/api.md section 4, the server only ever hands back the raw pieces
 * (`finishedTasks`, `moneySpentCents`, and the two dial defaults) and this tiny multiplication
 * runs live in the browser as the dials move, with no round trip. These functions exist so the
 * formula is written once, in one tested place, rather than trusted to match by eye wherever it
 * gets reimplemented -- see the note handed back with this work.
 */
export function heroNumbers(inputs: HeroInputs): HeroNumbers {
  const rawValueReturned = inputs.finishedTasks * inputs.hoursSavedPerTask * inputs.engineerHourlyCostCents
  const valueReturnedCents = Math.round(rawValueReturned)
  return { valueReturnedCents, netCents: valueReturnedCents - inputs.moneySpentCents }
}

/**
 * The point where this pays for itself, in minutes -- docs/product-brief.md's "Say the
 * break-even, not just the net". Falls out of the average cost per finished task and the hourly
 * rate alone, so it stays true even for a reader who disagrees with the hours-saved dial.
 *
 * break-even minutes = average cost per finished task, in cents
 *                       ÷ (engineer hourly cost in cents ÷ 60)
 *
 * Returned unrounded -- this is a rate, not a money amount, so there's no cents boundary to snap
 * to. "About four minutes" is a display choice for whoever renders this, not a rule this function
 * enforces.
 *
 * `null` when there's no hourly rate to divide by (a zero or negative dial) or nothing has
 * finished yet to average -- "no numbers means no answer, rather than zero", the same rule
 * `stats.ts` follows.
 */
export function breakEvenMinutes(
  averageCostPerFinishedTaskCents: number | null,
  engineerHourlyCostCents: number,
): number | null {
  if (averageCostPerFinishedTaskCents === null || engineerHourlyCostCents <= 0) return null
  const centsPerMinute = engineerHourlyCostCents / 60
  return averageCostPerFinishedTaskCents / centsPerMinute
}

// ---------------------------------------------------------------------------
// The service itself.
// ---------------------------------------------------------------------------

export class CostService {
  constructor(
    private readonly runs: RunRepository,
    private readonly turns: TurnRepository,
  ) {}

  /**
   * Every task chain that reached an end in the window, split into "eventually succeeded" and
   * "everything". A chain's cost is the sum of every attempt in it -- `RunRepository`'s
   * `listFinishedTaskCosts` already does that summing per chain (`COALESCE(parent_run_id, id)`),
   * counting the failed attempts along with the one that worked. That's the fairness rule from
   * docs/metrics.md: a cheap model that fails twice before succeeding must show up costing more
   * than an expensive model that gets it right first, not less.
   */
  costPerFinishedTask(orgId: number, window: DateWindow, filters?: RunFilters): CostPerTaskResult {
    const chains = this.runs.listFinishedTaskCosts(orgId, window, filters)
    const finishedCosts = chains.filter((c) => c.everSucceeded).map((c) => c.costCents)
    const attemptedCosts = chains.map((c) => c.costCents)
    return {
      perFinishedTask: summarizeTaskCosts(finishedCosts),
      perAttemptedTask: summarizeTaskCosts(attemptedCosts),
    }
  }

  /**
   * Raw token counts in the window, split fresh/cached/output/thinking -- never mixed with money,
   * so a reader can tell "we used more" apart from "the price changed".
   *
   * A run still in progress has no finished cost or duration yet (docs/metrics.md's "runs still
   * going" trap), so its turns are left out here too, the same as every other finished-run money
   * number -- `RunRepository.listRunning` is the one place that run's activity belongs.
   * `TurnRepository.listStartedInWindow` has no status filter of its own (turns don't carry a
   * run's status), so this service does the excluding itself by run id.
   */
  tokensUsed(orgId: number, window: DateWindow, filters?: ScopeFilters): TokensUsed {
    const runningRunIds = new Set(this.runs.listRunning(orgId, filters).map((r) => r.id))
    const turns = this.turns
      .listStartedInWindow(orgId, window, filters)
      .filter((t) => !runningRunIds.has(t.runId))

    return turns.reduce<TokensUsed>(
      (acc, t) => ({
        freshInput: acc.freshInput + t.tokensInFresh,
        cachedInput: acc.cachedInput + t.tokensInCached,
        output: acc.output + t.tokensOut,
        thinking: acc.thinking + t.tokensThinking,
      }),
      { ...emptyTokensUsed },
    )
  }
}
