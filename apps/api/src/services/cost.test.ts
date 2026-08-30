import { expect, test } from "bun:test"
import type { Run, Turn } from "@app/shared"
import type { FinishedTaskCost, RunFilters } from "../repositories/runs.ts"
import type { TurnRepository } from "../repositories/turns.ts"
import type { DateWindow, ScopeFilters } from "../repositories/types.ts"
import {
  breakEvenMinutes,
  CostService,
  heroNumbers,
  priceTurnCents,
  runCostCents,
  type ModelPrices,
  type TurnTokenCounts,
} from "./cost.ts"
import { makeFakeRunRepository } from "./test-helpers.ts"

const WINDOW: DateWindow = { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }

// A model price row cheap to reason about: $3/million fresh input, and every other rate a clean
// multiple of it so a wrong formula (say, cache read priced at full rate) produces an obviously
// wrong number rather than one that happens to coincide by accident.
const PRICE: ModelPrices = {
  inputPricePerMtokCents: 300, // $3.00 / million fresh input tokens
  cachedInputPricePerMtokCents: 30, // a tenth of the fresh rate
  cacheWritePricePerMtokCents: 375, // its own rate, distinct from both of the above
  outputPricePerMtokCents: 1500, // $15.00 / million output tokens
}

function noTokens(): TurnTokenCounts {
  return { tokensInFresh: 0, tokensInCached: 0, tokensCacheWrite: 0, tokensOut: 0, tokensThinking: 0 }
}

// ---------------------------------------------------------------------------
// Pricing a turn -- docs/testing.md Group 3, "Cost of one run".
// ---------------------------------------------------------------------------

test("cache-read tokens price at a tenth of the fresh rate, not lumped in with fresh at full price", () => {
  // One million of each: fresh, cache write, and cache read, all against the same PRICE table.
  const freshOnly = priceTurnCents({ ...noTokens(), tokensInFresh: 1_000_000 }, PRICE)
  const cacheReadOnly = priceTurnCents({ ...noTokens(), tokensInCached: 1_000_000 }, PRICE)
  const cacheWriteOnly = priceTurnCents({ ...noTokens(), tokensCacheWrite: 1_000_000 }, PRICE)

  expect(freshOnly).toBe(300) // the full fresh rate
  expect(cacheReadOnly).toBe(30) // a tenth of fresh -- its own column, never fresh's rate
  expect(cacheWriteOnly).toBe(375) // its own rate, not fresh's and not cache read's

  // Mixing all three in one turn adds them plainly -- nothing gets lumped into the fresh line.
  const mixed = priceTurnCents(
    { tokensInFresh: 1_000_000, tokensInCached: 1_000_000, tokensCacheWrite: 1_000_000, tokensOut: 0, tokensThinking: 0 },
    PRICE,
  )
  expect(mixed).toBe(300 + 30 + 375)
})

test("thinking tokens price at the output rate, on their own line, and can dwarf the visible answer", () => {
  // A small visible answer, but a long reasoning pass -- the shape docs/metrics.md warns about.
  const smallAnswer = priceTurnCents({ ...noTokens(), tokensOut: 10_000 }, PRICE)
  const longThinkingPass = priceTurnCents({ ...noTokens(), tokensThinking: 500_000 }, PRICE)

  expect(smallAnswer).toBe(Math.round((10_000 * 1500) / 1_000_000)) // 15 cents
  // Thinking billed at the exact same per-token rate as output, just a different token count.
  expect(longThinkingPass).toBe(Math.round((500_000 * 1500) / 1_000_000)) // 750 cents
  expect(longThinkingPass).toBeGreaterThan(smallAnswer * 10)

  const bothTogether = priceTurnCents({ ...noTokens(), tokensOut: 10_000, tokensThinking: 500_000 }, PRICE)
  expect(bothTogether).toBe(smallAnswer + longThinkingPass)
})

test("a turn keeps the cost it was priced at, even after the price table changes later", () => {
  const tokens: TurnTokenCounts = { tokensInFresh: 200_000, tokensInCached: 50_000, tokensCacheWrite: 10_000, tokensOut: 40_000, tokensThinking: 5_000 }
  const oldPrice = PRICE
  const costUnderOldPrice = priceTurnCents(tokens, oldPrice)

  // Prices doubling everywhere -- as if a new row landed in the models table with a later
  // effective_from. A turn is always priced from the row it actually points at
  // (`models.findById(turn.modelId)`), never "whatever's effective now", so re-pricing the same
  // tokens against the OLD row -- the one this turn is still linked to -- must come back
  // unchanged.
  const newPrice: ModelPrices = {
    inputPricePerMtokCents: oldPrice.inputPricePerMtokCents * 2,
    cachedInputPricePerMtokCents: oldPrice.cachedInputPricePerMtokCents * 2,
    cacheWritePricePerMtokCents: oldPrice.cacheWritePricePerMtokCents * 2,
    outputPricePerMtokCents: oldPrice.outputPricePerMtokCents * 2,
  }
  const costRepricedUnderNewRate = priceTurnCents(tokens, newPrice)
  const costOfTheSameOldTurnAfterwards = priceTurnCents(tokens, oldPrice)

  expect(costOfTheSameOldTurnAfterwards).toBe(costUnderOldPrice)
  expect(costRepricedUnderNewRate).not.toBe(costUnderOldPrice)
  expect(costRepricedUnderNewRate).toBe(costUnderOldPrice * 2)
})

test("a run's cost is its turn costs plus its tool call costs, with no hourly rate for tools", () => {
  // A free tool call (cost 0) and a billed one, alongside two turns.
  const cost = runCostCents([120, 380], [0, 45])
  expect(cost).toBe(120 + 380 + 0 + 45)
})

test("money never drifts through a float, whatever order the costs are added in", () => {
  const costs = Array.from({ length: 300 }, (_, i) => [33, 34, 33][i % 3]!)
  const forwardTotal = runCostCents(costs, [])
  const shuffled = [...costs].reverse()
  const shuffledTotal = runCostCents(shuffled, [])
  expect(forwardTotal).toBe(shuffledTotal)
  expect(Number.isInteger(forwardTotal)).toBe(true)
  expect(forwardTotal).toBe(costs.reduce((a, b) => a + b, 0))
})

// ---------------------------------------------------------------------------
// Cost per finished task -- fake RunRepository, no database.
// ---------------------------------------------------------------------------

const fakeRunRepo = makeFakeRunRepository

function fakeTurnRepo(overrides: Partial<TurnRepository>): TurnRepository {
  return {
    create: () => {
      throw new Error("not used")
    },
    findById: () => undefined,
    listByRunId: () => [],
    listStartedInWindow: () => [],
    ...overrides,
  }
}

test("a failed attempt's cost counts toward cost per finished task, not just the winning run's", () => {
  // One task, three runs: two failures (200 + 300 cents) then a 100-cent success. The repository
  // has already collapsed the chain -- this is exactly the docs/testing.md fixture.
  const chain: FinishedTaskCost = { taskId: 1, costCents: 600, attemptCount: 3, everSucceeded: true }
  const repo = fakeRunRepo({ listFinishedTaskCosts: () => [chain] })
  const service = new CostService(repo, fakeTurnRepo({}))

  const result = service.costPerFinishedTask(1, WINDOW)

  expect(result.perFinishedTask.taskCount).toBe(1)
  expect(result.perFinishedTask.medianCents).toBe(600) // all three attempts, not just the 100-cent winner
  expect(result.perFinishedTask.worstCents).toBe(600)
})

test("median leads and stays put on a long-tailed set; the average is dragged and shown beside it", () => {
  const chains: FinishedTaskCost[] = [
    ...Array.from({ length: 9 }, (_, i): FinishedTaskCost => ({ taskId: i, costCents: 100, attemptCount: 1, everSucceeded: true })),
    { taskId: 9, costCents: 10_000, attemptCount: 1, everSucceeded: true },
  ]
  const service = new CostService(fakeRunRepo({ listFinishedTaskCosts: () => chains }), fakeTurnRepo({}))

  const { perFinishedTask } = service.costPerFinishedTask(1, WINDOW)

  expect(perFinishedTask.medianCents).toBe(100) // untouched by the one runaway task
  expect(perFinishedTask.averageCents).toBe(1090) // (9 * 100 + 10000) / 10, visibly dragged up
  expect(perFinishedTask.worstCents).toBe(10_000)
  expect(perFinishedTask.taskCount).toBe(10)
})

test("a task chain that never succeeded counts toward cost per attempted task, but not per finished task", () => {
  const succeeded: FinishedTaskCost = { taskId: 1, costCents: 100, attemptCount: 1, everSucceeded: true }
  const neverSucceeded: FinishedTaskCost = { taskId: 2, costCents: 5_000, attemptCount: 4, everSucceeded: false }
  const service = new CostService(fakeRunRepo({ listFinishedTaskCosts: () => [succeeded, neverSucceeded] }), fakeTurnRepo({}))

  const result = service.costPerFinishedTask(1, WINDOW)

  expect(result.perFinishedTask.taskCount).toBe(1)
  expect(result.perFinishedTask.worstCents).toBe(100) // the never-succeeded chain isn't in here...
  expect(result.perAttemptedTask.taskCount).toBe(2)
  expect(result.perAttemptedTask.worstCents).toBe(5_000) // ...but it isn't hidden either
})

test("no finished tasks in the window means no answer, not a zero that reads as free", () => {
  const service = new CostService(fakeRunRepo({ listFinishedTaskCosts: () => [] }), fakeTurnRepo({}))
  const { perFinishedTask, perAttemptedTask } = service.costPerFinishedTask(1, WINDOW)
  expect(perFinishedTask).toEqual({ medianCents: null, averageCents: null, worstCents: null, taskCount: 0 })
  expect(perAttemptedTask.taskCount).toBe(0)
})

test("cost per finished task is scoped by the filters it's given, same as the repository call", () => {
  let receivedFilters: RunFilters | undefined
  const repo = fakeRunRepo({
    listFinishedTaskCosts: (_orgId, _window, filters) => {
      receivedFilters = filters
      return []
    },
  })
  const service = new CostService(repo, fakeTurnRepo({}))
  service.costPerFinishedTask(1, WINDOW, { teamId: 7 })
  expect(receivedFilters).toEqual({ teamId: 7 })
})

// ---------------------------------------------------------------------------
// Tokens used
// ---------------------------------------------------------------------------

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 1,
    runId: 1,
    turnIndex: 0,
    modelId: 1,
    tokensInFresh: 0,
    tokensInCached: 0,
    tokensCacheWrite: 0,
    tokensOut: 0,
    tokensThinking: 0,
    latencyMs: 100,
    finishReason: "stop" as const,
    costCents: 0,
    startedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  }
}

test("tokens used are reported fresh/cached/output/thinking, separately from any money", () => {
  const turns = [
    turn({ id: 1, runId: 1, tokensInFresh: 100, tokensInCached: 20, tokensOut: 30, tokensThinking: 5 }),
    turn({ id: 2, runId: 1, tokensInFresh: 50, tokensInCached: 10, tokensOut: 15, tokensThinking: 200 }),
  ]
  const service = new CostService(fakeRunRepo({}), fakeTurnRepo({ listStartedInWindow: () => turns }))

  expect(service.tokensUsed(1, WINDOW)).toEqual({ freshInput: 150, cachedInput: 30, output: 45, thinking: 205 })
})

test("a run still in progress has no finished cost yet, so its tokens don't count here either", () => {
  const finishedRunId = 1
  const runningRunId = 2
  const turns = [
    turn({ id: 1, runId: finishedRunId, tokensInFresh: 100 }),
    turn({ id: 2, runId: runningRunId, tokensInFresh: 999_999 }), // would swamp the total if counted
  ]
  const runningRun = { id: runningRunId, finishedAt: null } as unknown as Run
  const service = new CostService(
    fakeRunRepo({ listRunning: () => [runningRun] }),
    fakeTurnRepo({ listStartedInWindow: () => turns }),
  )

  expect(service.tokensUsed(1, WINDOW).freshInput).toBe(100)
})

test("no turns in the window is reported as all zeros, not an absence", () => {
  const service = new CostService(fakeRunRepo({}), fakeTurnRepo({ listStartedInWindow: () => [] }))
  expect(service.tokensUsed(1, WINDOW)).toEqual({ freshInput: 0, cachedInput: 0, output: 0, thinking: 0 })
})

// ---------------------------------------------------------------------------
// The hero number and the break-even line -- docs/product-brief.md.
// ---------------------------------------------------------------------------

test("value returned, and net, follow the formula in docs/product-brief.md exactly", () => {
  const { valueReturnedCents, netCents } = heroNumbers({
    finishedTasks: 40,
    hoursSavedPerTask: 0.5,
    engineerHourlyCostCents: 8_500, // $85/hour
    moneySpentCents: 50_000, // $500 spent
  })

  // 40 tasks * 0.5 hours saved * $85/hour = $1,700 = 170,000 cents.
  expect(valueReturnedCents).toBe(170_000)
  expect(netCents).toBe(170_000 - 50_000)
})

test("break-even minutes falls out of average cost per finished task and the hourly rate alone", () => {
  // The worked example from docs/product-brief.md: about $5.31 a task, $85/hour, "about four
  // minutes" once rounded for display.
  const minutes = breakEvenMinutes(531, 8_500)
  expect(minutes).not.toBeNull()
  expect(minutes!).toBeCloseTo((531 * 60) / 8_500, 10)
  expect(Math.round(minutes!)).toBe(4)
})

test("break-even is not computed from a made-up value dial, only from cost and the hourly rate", () => {
  // Changing the hours-saved dial (not passed to breakEvenMinutes at all) must not move this
  // number -- that's the whole point docs/product-brief.md makes about it staying true even when
  // a reader disagrees with the dial.
  const minutes = breakEvenMinutes(531, 8_500)
  expect(breakEvenMinutes(531, 8_500)).toBe(minutes)
})

test("break-even has no answer when there's no hourly rate, or nothing has finished yet to average", () => {
  expect(breakEvenMinutes(531, 0)).toBeNull()
  expect(breakEvenMinutes(531, -100)).toBeNull()
  expect(breakEvenMinutes(null, 8_500)).toBeNull()
})

test("a turn is rounded to whole cents once, not once per part", () => {
  // Five parts, each landing just under half a cent on its own. Rounded separately they would
  // each drop to zero and the turn would price at nothing; added first, they are worth 2 cents.
  const price = {
    inputPricePerMtokCents: 1_000,
    cachedInputPricePerMtokCents: 1_000,
    cacheWritePricePerMtokCents: 1_000,
    outputPricePerMtokCents: 1_000,
  }
  const fourTenthsOfACent = 400 // 400 tokens x 1000 cents/Mtok = 0.4 cents

  const together = priceTurnCents(
    {
      tokensInFresh: fourTenthsOfACent,
      tokensInCached: fourTenthsOfACent,
      tokensCacheWrite: fourTenthsOfACent,
      tokensOut: fourTenthsOfACent,
      tokensThinking: fourTenthsOfACent,
    },
    price,
  )

  const ifEachPartWereRoundedFirst = 5 * Math.round(0.4)

  expect(together).toBe(2) // 5 x 0.4 = 2.0 cents
  expect(ifEachPartWereRoundedFirst).toBe(0) // every part vanishes on its own
  expect(together).not.toBe(ifEachPartWereRoundedFirst)
})
