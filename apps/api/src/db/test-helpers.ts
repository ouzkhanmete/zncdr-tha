// Shared setup for db tests. Not itself a test file -- bun test only picks up
// `*.test.ts`, so this can hold plain helpers without being run as a suite of its own.

import type { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./connect.ts"
import { migrate } from "./migrate.ts"

export const MIGRATIONS = join(import.meta.dir, "../../migrations")

/** A real database on disk, built from the real migration files — never a hand-copied schema,
 *  so a broken migration cannot hide behind a passing test. */
export function freshDb(): { db: Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "agent-analytics-"))
  const db = openDatabase(join(dir, "test.db"))
  migrate(db, MIGRATIONS)
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function seedOrgTeamEngineer(db: Database) {
  db.exec(`INSERT INTO orgs (name,licensed_seats,created_at) VALUES ('Acme',130,'2026-01-01T00:00:00Z')`)
  db.exec(`INSERT INTO teams (org_id,name,created_at) VALUES (1,'Nova','2026-01-01T00:00:00Z')`)
  db.exec(`INSERT INTO engineers (org_id,team_id,handle,display_name,seat_granted_at,seat_active)
           VALUES (1,1,'p.nair','Priya Nair','2026-01-01T00:00:00Z',1)`)
}

const RUN_COLS = `org_id,team_id,engineer_id,parent_run_id,agent_kind,"trigger",started_at,
                  actor_utc_offset_minutes,finished_at,status,failure_cause,blame,duration_ms,total_cost_cents`

export function addRun(
  db: Database,
  parent: number | null,
  status: string,
  cause: string | null,
  blame: string | null,
  cents: number,
) {
  db.query(
    `INSERT INTO runs (${RUN_COLS}) VALUES (1,1,1,?,'coder','person','2026-08-01T09:00:00Z',0,
     '2026-08-01T09:05:00Z',?,?,?,300000,?)`,
  ).run(parent, status, cause, blame, cents)
}
