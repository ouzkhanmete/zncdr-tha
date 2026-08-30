import type { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { CURRENT_MONTH_START_MS, DATA_END_MS, DEFAULT_SEED, DOMINANT_FAILURE_TEAM, TEAM_MOVE, toIso } from "../config.ts"
import { buildSeededDb } from "../test-helpers.ts"
import { generateSeedData, type SeedDataset } from "./index.ts"

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

test("the fixed seed is reproducible: running the generator twice gives identical data", () => {
  const again = generateSeedData(DEFAULT_SEED)
  expect(again).toEqual(data)
})

test("exactly one team ends the month over its stop line, and one sits just under its warning line", () => {
  const monthStart = toIso(new Date(CURRENT_MONTH_START_MS))
  const monthEnd = toIso(new Date(DATA_END_MS))
  const rows = db
    .query<
      { name: string; limit_cents: number; warn_cents: number; stop_cents: number; spent: number },
      [string, string]
    >(
      `SELECT t.name, b.limit_cents, b.warn_cents, b.stop_cents,
              COALESCE((SELECT SUM(r.total_cost_cents) FROM runs r
                         WHERE r.team_id = t.id AND r.started_at >= ? AND r.started_at < ?), 0) AS spent
       FROM teams t JOIN budgets b ON b.team_id = t.id`,
    )
    .all(monthStart, monthEnd)

  const overStop = rows.filter((r) => r.spent > r.stop_cents)
  expect(overStop.map((r) => r.name)).toEqual(["Nova"])

  const atlas = rows.find((r) => r.name === "Atlas")!
  expect(atlas.spent).toBeLessThan(atlas.warn_cents)
  // "Just under" the warning line, not comfortably under it.
  expect(atlas.spent / atlas.warn_cents).toBeGreaterThan(0.9)
})

test("the median cost per finished task sits far below the average -- the long tail is real", () => {
  // The same collapse-the-chain-to-one-task shape as docs/data-model.md section 4.
  const row = db
    .query<{ median_cents: number; avg_cents: number; max_cents: number; n: number }, []>(
      `WITH chain AS (
         SELECT COALESCE(parent_run_id, id) AS task_id, total_cost_cents, status
         FROM runs WHERE finished_at IS NOT NULL
       ),
       totals AS (
         SELECT task_id, SUM(total_cost_cents) AS cost, MAX(status = 'succeeded') AS won
         FROM chain GROUP BY task_id
       ),
       finished AS (SELECT cost FROM totals WHERE won = 1),
       ranked AS (
         SELECT cost, ROW_NUMBER() OVER (ORDER BY cost) AS rn, COUNT(*) OVER () AS n FROM finished
       )
       SELECT
         (SELECT AVG(cost) FROM ranked WHERE rn IN ((n + 1) / 2, (n + 2) / 2)) AS median_cents,
         (SELECT AVG(cost) FROM finished) AS avg_cents,
         (SELECT MAX(cost) FROM finished) AS max_cents,
         (SELECT COUNT(*) FROM finished) AS n`,
    )
    .get()!

  expect(row.n).toBeGreaterThan(100)
  expect(row.median_cents).toBeGreaterThan(0)
  // The average is dragged well above the median by a small share of very expensive tasks.
  expect(row.avg_cents).toBeGreaterThan(row.median_cents * 3)
  expect(row.max_cents).toBeGreaterThan(row.avg_cents * 10)
})

test("every seeded run has a short, non-empty task summary -- never the full task text", () => {
  expect(data.runs.length).toBeGreaterThan(0)
  for (const run of data.runs) {
    expect(run.taskSummary.trim().length).toBeGreaterThan(0)
    // "Short" per docs/data-model.md's callout -- nowhere near a full prompt's length.
    expect(run.taskSummary.length).toBeLessThan(80)
  }

  // The database agrees -- no row was left with the migration's empty-string default.
  const blank = db
    .query<{ n: number }, []>("SELECT COUNT(*) n FROM runs WHERE task_summary = '' OR task_summary IS NULL")
    .get()!.n
  expect(blank).toBe(0)

  // Retries of the same task keep the same summary -- it's the same task, retried, not a new one.
  const chain = data.runs.filter((r) => r.parentRunId !== null)
  expect(chain.length).toBeGreaterThan(0)
  for (const retry of chain) {
    const first = data.runs.find((r) => r.id === retry.parentRunId)!
    expect(retry.taskSummary).toBe(first.taskSummary)
  }
})

test("some licensed seats are dormant -- a seat that never ran a single thing", () => {
  const dormant = db
    .query<{ n: number }, []>(
      `SELECT COUNT(*) n FROM engineers e WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.engineer_id = e.id)`,
    )
    .get()!.n
  expect(dormant).toBeGreaterThan(0)
  // Roughly the "about 18%" org-wide figure from docs/seed-data.md -- a loose band, since the
  // exact split is tuned per team, not a single global constant.
  const share = dormant / data.engineers.length
  expect(share).toBeGreaterThan(0.08)
  expect(share).toBeLessThan(0.3)
})

test("every retry points at the first run of its chain, never at another retry", () => {
  // The database itself enforces this (runs_parent_must_be_first, checked above by the fact
  // loadSeedData didn't throw). This confirms the shape directly: no run's parent has a parent
  // of its own, and retries actually exist in the data -- this isn't vacuously true.
  const retryCount = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM runs WHERE parent_run_id IS NOT NULL").get()!.n
  expect(retryCount).toBeGreaterThan(0)

  const doubleHops = db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) n FROM runs r JOIN runs p ON r.parent_run_id = p.id WHERE p.parent_run_id IS NOT NULL",
    )
    .get()!.n
  expect(doubleHops).toBe(0)
})

test("a turn before quickpatch-1's day-100 price cut and one after cost different amounts for identical token counts", () => {
  const rows = db
    .query<{ id: number; effective_from: string; input_price_per_mtok_cents: number; cached_input_price_per_mtok_cents: number; cache_write_price_per_mtok_cents: number; output_price_per_mtok_cents: number }, []>(
      "SELECT * FROM models WHERE name = 'quickpatch-1' ORDER BY effective_from",
    )
    .all()
  expect(rows).toHaveLength(2)
  const [before, after] = rows as [(typeof rows)[number], (typeof rows)[number]]
  expect(after.input_price_per_mtok_cents).toBeLessThan(before.input_price_per_mtok_cents)

  // Same made-up token counts, priced under each row -- the formula from docs/metrics.md.
  const tokens = { fresh: 200_000, cached: 50_000, cacheWrite: 10_000, out: 80_000, thinking: 20_000 }
  const costUnder = (m: (typeof rows)[number]) =>
    Math.round(
      (tokens.fresh * m.input_price_per_mtok_cents +
        tokens.cacheWrite * m.cache_write_price_per_mtok_cents +
        tokens.cached * m.cached_input_price_per_mtok_cents +
        tokens.out * m.output_price_per_mtok_cents +
        tokens.thinking * m.output_price_per_mtok_cents) /
        1_000_000,
    )
  expect(costUnder(before)).not.toBe(costUnder(after))

  // And the seed didn't just leave the price table with two unused rows -- both actually priced
  // real turns, one from before day 100 and one from on or after it.
  const usedModelIds = new Set(
    db
      .query<{ model_id: number }, [number, number]>("SELECT DISTINCT model_id FROM turns WHERE model_id IN (?, ?)")
      .all(before.id, after.id)
      .map((r) => r.model_id),
  )
  expect(usedModelIds.has(before.id)).toBe(true)
  expect(usedModelIds.has(after.id)).toBe(true)
})

test("an engineer who changed teams mid-window has runs stamped with both team ids, but their own record shows only where they are now", () => {
  // See docs/data-model.md's callout on runs.team_id: a run is stamped with a team at the moment
  // it starts and never re-derived through the engineer later. TEAM_MOVE is the one seeded case
  // where that actually matters -- someone whose team really did change partway through.
  const rows = db
    .query<{ engineer_id: number; team_id: number; n: number }, []>(
      `SELECT engineer_id, team_id, COUNT(*) n FROM runs
       WHERE engineer_id IS NOT NULL GROUP BY engineer_id, team_id`,
    )
    .all()

  const teamIdsByEngineer = new Map<number, { teamId: number; n: number }[]>()
  for (const row of rows) {
    const list = teamIdsByEngineer.get(row.engineer_id) ?? []
    list.push({ teamId: row.team_id, n: row.n })
    teamIdsByEngineer.set(row.engineer_id, list)
  }
  const movers = [...teamIdsByEngineer.entries()].filter(([, teams]) => teams.length > 1)
  expect(movers.length).toBeGreaterThan(0)

  const [engineerId, teams] = movers[0]!
  expect(teams.length).toBe(2)
  // Enough runs on each side that both teams' histories visibly include this person's work --
  // not a token blip on either end.
  for (const t of teams) expect(t.n).toBeGreaterThan(10)

  const engineerRow = db
    .query<{ team_id: number }, [number]>("SELECT team_id FROM engineers WHERE id = ?")
    .get(engineerId)!
  // engineers.team_id holds only where they are now -- one of the two teams their runs carry,
  // never both.
  expect(teams.map((t) => t.teamId)).toContain(engineerRow.team_id)

  const fromTeam = data.teams.find((t) => t.name === TEAM_MOVE.fromTeam)!
  const toTeam = data.teams.find((t) => t.name === TEAM_MOVE.toTeam)!
  expect(engineerRow.team_id).toBe(toTeam.id)
  expect(teams.map((t) => t.teamId).sort()).toEqual([fromTeam.id, toTeam.id].sort())
})

test("one team's org-setup failures concentrate on a single cause -- the 'fix this one thing' story", () => {
  // See docs/seed-data.md and apps/web's failureCallout.ts: the team screen calls out a cause
  // once it clears 50% of a team's own org-setup failures. Pin this to the actual team named in
  // config.ts, not just "some team somewhere", since that's the one the acceptance scenario and
  // the doc both point at.
  const rows = db
    .query<{ cause: string; n: number }, [string]>(
      `SELECT r.failure_cause AS cause, COUNT(*) AS n
       FROM runs r JOIN teams t ON t.id = r.team_id
       WHERE t.name = ? AND r.blame = 'org_setup'
       GROUP BY r.failure_cause
       ORDER BY n DESC`,
    )
    .all(DOMINANT_FAILURE_TEAM)

  const total = rows.reduce((sum, r) => sum + r.n, 0)
  // Enough org-setup failures to be a real, visible pattern, not one lucky (or unlucky) row.
  expect(total).toBeGreaterThan(5)

  const top = rows[0]!
  expect(top.n / total).toBeGreaterThanOrEqual(0.5)
})
