import { expect, test } from "bun:test"
import type { Budget } from "@app/shared"
import type { BudgetRepository } from "../repositories/budgets.ts"
import { BudgetWriteService, InvalidBudgetError } from "./budget-write.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

function fakeBudgetRepo(upserted: Budget[], existing: Budget[] = []): BudgetRepository {
  return {
    findById: notImplemented("findById"),
    listByOrgAndMonth: notImplemented("listByOrgAndMonth"),
    findByTeamAndMonth: (teamId, month) => existing.find((b) => b.teamId === teamId && b.month === month),
    upsert: (input) => {
      const saved = { id: 1, ...input }
      upserted.push(saved)
      return saved
    },
  }
}

test("getRawBudget returns undefined when nobody has set one yet, for the controller's 404", () => {
  const service = new BudgetWriteService(fakeBudgetRepo([]))
  expect(service.getRawBudget(7, "2026-08")).toBeUndefined()
})

test("getRawBudget returns the raw setting for one team and month, spend numbers aside", () => {
  const existing: Budget = { id: 1, teamId: 7, month: "2026-08", limitCents: 100_000, warnCents: 80_000, stopCents: 100_000, updatedAt: "2026-08-01T00:00:00Z" }
  const service = new BudgetWriteService(fakeBudgetRepo([], [existing]))
  expect(service.getRawBudget(7, "2026-08")).toEqual(existing)
})

test("a team exactly at stopCents == limitCents is the normal case, not an error", () => {
  const saved: Budget[] = []
  const service = new BudgetWriteService(fakeBudgetRepo(saved))
  const result = service.setBudget(7, { month: "2026-08", limitCents: 100_000, warnCents: 80_000, stopCents: 100_000 }, "2026-08-15T00:00:00Z")
  expect(result.stopCents).toBe(100_000)
  expect(saved).toHaveLength(1)
})

test("a stop line above the limit is rejected with invalid_budget's exact message", () => {
  const service = new BudgetWriteService(fakeBudgetRepo([]))
  expect(() => service.setBudget(7, { month: "2026-08", limitCents: 50_000, warnCents: 10_000, stopCents: 60_000 }, "2026-08-15T00:00:00Z")).toThrow(
    InvalidBudgetError,
  )
})

test("a warning line at or above the stop line is rejected -- equal counts as invalid, not just above", () => {
  const service = new BudgetWriteService(fakeBudgetRepo([]))
  try {
    service.setBudget(7, { month: "2026-08", limitCents: 100_000, warnCents: 80_000, stopCents: 80_000 }, "2026-08-15T00:00:00Z")
    throw new Error("expected setBudget to throw")
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidBudgetError)
    expect((err as InvalidBudgetError).message).toBe("The warning line has to sit below the stop line.")
  }
})

test("a value breaking both rules reports the stop-line-above-limit rule, checked first", () => {
  const service = new BudgetWriteService(fakeBudgetRepo([]))
  try {
    service.setBudget(7, { month: "2026-08", limitCents: 10_000, warnCents: 90_000, stopCents: 90_000 }, "2026-08-15T00:00:00Z")
    throw new Error("expected setBudget to throw")
  } catch (err) {
    expect((err as InvalidBudgetError).message).toBe("The stop line cannot sit above the limit.")
  }
})

test("a valid budget is written through to the repository with the given month and lines", () => {
  const saved: Budget[] = []
  const service = new BudgetWriteService(fakeBudgetRepo(saved))
  service.setBudget(7, { month: "2026-08", limitCents: 100_000, warnCents: 80_000, stopCents: 100_000 }, "2026-08-15T00:00:00Z")
  expect(saved[0]).toMatchObject({ teamId: 7, month: "2026-08", limitCents: 100_000, warnCents: 80_000, stopCents: 100_000, updatedAt: "2026-08-15T00:00:00Z" })
})
