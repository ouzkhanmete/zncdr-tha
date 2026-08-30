import type { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import type { SeedDataset } from "./generate/index.ts"
import { buildSeededDb } from "./test-helpers.ts"

let db: Database
let cleanupDb: () => void
let data: SeedDataset

beforeAll(() => {
  const seeded = buildSeededDb()
  db = seeded.db
  data = seeded.data
  cleanupDb = seeded.cleanup
})

afterAll(() => cleanupDb())

test("the whole dataset is accepted by the real schema, with every table filled", () => {
  const count = (table: string) => (db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n
  expect(count("orgs")).toBe(1)
  expect(count("teams")).toBe(data.teams.length)
  expect(count("engineers")).toBe(data.engineers.length)
  expect(count("models")).toBe(data.models.length)
  expect(count("budgets")).toBe(data.budgets.length)
  expect(count("runs")).toBe(data.runs.length)
  expect(count("turns")).toBe(data.turns.length)
  expect(count("tool_calls")).toBe(data.toolCalls.length)
  expect(count("artifacts")).toBe(data.artifacts.length)
  expect(count("policy_flags")).toBe(data.policyFlags.length)
})
