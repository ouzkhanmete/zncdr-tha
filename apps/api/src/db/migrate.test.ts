import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./connect.ts"
import { migrate } from "./migrate.ts"
import { freshDb, MIGRATIONS } from "./test-helpers.ts"

test("migrations build the whole schema and only run once", () => {
  const { db, cleanup } = freshDb()
  try {
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name)
    for (const t of ["orgs", "teams", "engineers", "models", "runs", "turns", "tool_calls", "artifacts", "policy_flags", "budgets"]) {
      expect(tables).toContain(t)
    }
    // Running again applies nothing — the runner is safe to call on every start.
    expect(migrate(db, MIGRATIONS)).toEqual([])
  } finally {
    cleanup()
  }
})

test("migration 0002 applies cleanly on top of 0001, in order, and running everything twice is a no-op", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-analytics-migrate-"))
  try {
    const db = openDatabase(join(dir, "test.db"))

    const firstRun = migrate(db, MIGRATIONS)
    expect(firstRun).toEqual(["0001_initial.sql", "0002_add_task_summary.sql"])

    // The column 0002 adds is really there, not just recorded as applied.
    const columns = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('runs')")
      .all()
      .map((c) => c.name)
    expect(columns).toContain("task_summary")

    // Running every migration again -- 0001 and 0002 both already applied -- changes nothing.
    expect(migrate(db, MIGRATIONS)).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
