// Shared setup for service-level unit tests. Not itself a test file -- bun test only picks up
// `*.test.ts`, so this can hold a plain helper without being run as a suite of its own. Mirrors
// apps/api/src/repositories/test-helpers.ts's own reason for existing.

import type { RunRepository } from "../repositories/runs.ts"

/** A `RunRepository` fake for services that only need a handful of its methods answered for a
 *  given test -- every method not overridden throws or returns empty, so a test only has to
 *  describe the rows its scenario actually needs. Shared by every service test that fakes this
 *  repository the same generic way (budget, cost, reliability, speed), so widening the interface
 *  means changing this one function instead of each test file that fakes it. `adoption.test.ts`
 *  and `outcome.test.ts` build their own fakes instead -- they hand `RunRepository`'s methods
 *  more specific, scenario-shaped answers than a flat set of overrides would give them. */
export function makeFakeRunRepository(overrides: Partial<RunRepository> = {}): RunRepository {
  return {
    create: () => {
      throw new Error("not implemented")
    },
    findById: () => undefined,
    updateRollups: () => undefined,
    listChainMembers: () => [],
    listFinishedTaskCosts: () => [],
    listEndedRuns: () => [],
    listTaskOutcomesStartedIn: () => [],
    listRunning: () => [],
    search: () => ({ items: [], total: 0 }),
    listStartedIn: () => [],
    everStartedEngineerIds: () => [],
    listDailyCostTotals: () => [],
    ...overrides,
  }
}
