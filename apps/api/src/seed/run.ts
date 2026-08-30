// The `bun run seed` entry point (see apps/api/package.json). Opens the database, runs every
// migration, empties every table, fills them with 180 days of made-up but believable activity,
// and prints a summary so a person can tell at a glance whether it came out looking right.

import { join } from "node:path"
import { openDatabase } from "../db/connect.ts"
import { migrate } from "../db/migrate.ts"
import { CURRENT_MONTH_START_MS, DATA_END_MS, DEFAULT_SEED } from "./config.ts"
import { generateSeedData, type SeedDataset } from "./generate/index.ts"
import { loadSeedData } from "./insert.ts"

function parseSeedFlag(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--seed="))
  if (!flag) return DEFAULT_SEED
  const value = Number(flag.slice("--seed=".length))
  if (!Number.isFinite(value)) throw new Error(`--seed must be a number, got "${flag}"`)
  return value
}

function centsToDollarString(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function currentMonthSpend(data: SeedDataset, teamId: number): number {
  return data.runs
    .filter((r) => r.teamId === teamId && r.startedAtMs >= CURRENT_MONTH_START_MS && r.startedAtMs < DATA_END_MS)
    .reduce((sum, r) => sum + r.totalCostCents, 0)
}

function printSummary(data: SeedDataset): void {
  console.log("")
  console.log("Rows written:")
  console.log(`  orgs          1`)
  console.log(`  teams         ${data.teams.length}`)
  console.log(`  engineers     ${data.engineers.length}`)
  console.log(`  models        ${data.models.length}`)
  console.log(`  budgets       ${data.budgets.length}`)
  console.log(`  runs          ${data.runs.length}`)
  console.log(`  turns         ${data.turns.length}`)
  console.log(`  tool_calls    ${data.toolCalls.length}`)
  console.log(`  artifacts     ${data.artifacts.length}`)
  console.log(`  policy_flags  ${data.policyFlags.length}`)

  const byName = (name: string) => data.teams.find((t) => t.name === name)!
  const nova = byName("Nova")
  const atlas = byName("Atlas")
  const comet = byName("Comet")
  const anchor = byName("Anchor")

  const novaBudget = data.budgets.find((b) => b.teamId === nova.id)!
  const atlasBudget = data.budgets.find((b) => b.teamId === atlas.id)!
  const novaSpent = currentMonthSpend(data, nova.id)
  const atlasSpent = currentMonthSpend(data, atlas.id)
  const cometRuns = data.runs.filter((r) => r.teamId === comet.id).length
  const anchorRuns = data.runs.filter((r) => r.teamId === anchor.id).length
  const anchorShare = ((anchorRuns / data.runs.length) * 100).toFixed(0)

  console.log("")
  console.log("Headline checks (see docs/seed-data.md):")
  console.log(
    `  Nova this month:   ${centsToDollarString(novaSpent)} of ${centsToDollarString(novaBudget.limitCents)} -- ` +
      (novaSpent > novaBudget.stopCents ? "OVER its stop line" : "under its stop line, expected OVER"),
  )
  console.log(
    `  Atlas this month:  ${centsToDollarString(atlasSpent)} of ${centsToDollarString(atlasBudget.limitCents)} -- ` +
      (atlasSpent < atlasBudget.warnCents ? "just under its warning line" : "AT OR OVER its warning line, expected under"),
  )
  console.log(`  Comet's run count: ${cometRuns} over 180 days (3 engineers)`)
  console.log(`  Anchor's run count: ${anchorRuns} (${anchorShare}% of every run in the org, 40 engineers)`)
  console.log("")
}

function main(): void {
  const seed = parseSeedFlag(process.argv.slice(2))
  const dbPath = process.env.DB_PATH ?? join(import.meta.dir, "../../data.db")
  const migrationsDir = join(import.meta.dir, "../../migrations")

  console.log(`Seeding ${dbPath} (seed=${seed})...`)

  const db = openDatabase(dbPath)
  migrate(db, migrationsDir)

  const data = generateSeedData(seed)
  loadSeedData(db, data)

  printSummary(data)
  db.close()
}

main()
