import { expect, test } from "bun:test"
import type { RunRepository } from "../repositories/runs.ts"
import { CostService } from "./cost.ts"
import { SummaryService } from "./summary.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

/** A fake covering only what SummaryService and the CostService it drives actually call. */
function fakeRunRepo(opts: {
  finishedTaskCosts: { costCents: number; everSucceeded: boolean }[]
  dailyTotals: { date: string; costCents: number }[]
}): RunRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    updateRollups: notImplemented("updateRollups"),
    listChainMembers: notImplemented("listChainMembers"),
    listEndedRuns: notImplemented("listEndedRuns"),
    listTaskOutcomesStartedIn: notImplemented("listTaskOutcomesStartedIn"),
    listRunning: notImplemented("listRunning"),
    search: notImplemented("search"),
    listStartedIn: notImplemented("listStartedIn"),
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),
    listFinishedTaskCosts: () =>
      opts.finishedTaskCosts.map((c, i) => ({ taskId: i, attemptCount: 1, ...c })),
    listDailyCostTotals: () => opts.dailyTotals,
  }
}

test("finishedTasks counts only chains that ever succeeded, same rule as cost per finished task", () => {
  const runs = fakeRunRepo({
    finishedTaskCosts: [
      { costCents: 100, everSucceeded: true },
      { costCents: 500, everSucceeded: true },
      { costCents: 900, everSucceeded: false },
    ],
    dailyTotals: [],
  })
  const summary = new SummaryService(runs, new CostService(runs, notImplemented("turns") as never))
  const result = summary.getSummary({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z" })
  expect(result.finishedTasks).toBe(2)
})

test("moneySpentCents adds up every run's cost in the window, failed and in-progress runs included", () => {
  // listDailyCostTotals carries no status filter at all -- this is the one number in the whole
  // API that is NOT restricted to finished runs, per docs/api.md section 10.
  const runs = fakeRunRepo({
    finishedTaskCosts: [],
    dailyTotals: [
      { date: "2026-08-01", costCents: 250 },
      { date: "2026-08-02", costCents: 175 },
    ],
  })
  const summary = new SummaryService(runs, new CostService(runs, notImplemented("turns") as never))
  const result = summary.getSummary({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z" })
  expect(result.moneySpentCents).toBe(425)
})

test("hands back the server's own defaults for the two hero dials", () => {
  const runs = fakeRunRepo({ finishedTaskCosts: [], dailyTotals: [] })
  const summary = new SummaryService(runs, new CostService(runs, notImplemented("turns") as never))
  const result = summary.getSummary({ orgId: 1, from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z" })
  expect(result.defaults).toEqual({ hoursSavedPerTask: 1.0, engineerHourlyCostCents: 8_500 })
})
