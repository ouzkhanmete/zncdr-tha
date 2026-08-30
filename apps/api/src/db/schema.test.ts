// Covers migrations/*.sql -- the schema itself has no .ts file to sit beside, so these tests
// pin down what the migration SQL guarantees (triggers and CHECK constraints), not any
// TypeScript.
import { expect, test } from "bun:test"
import { addRun, freshDb, seedOrgTeamEngineer } from "./test-helpers.ts"

test("a retry must point at the first attempt, so a task cannot split in two", () => {
  const { db, cleanup } = freshDb()
  try {
    seedOrgTeamEngineer(db)
    addRun(db, null, "failed", "missing_secret_or_login", "org_setup", 300) // id 1
    addRun(db, 1, "failed", "tests_failed", "task", 200) // id 2, points at the first

    // Pointing at attempt 2 would make attempts 3+ look like their own separate task:
    // the cost of one task gets reported as two cheaper ones and the finished count inflates.
    expect(() => addRun(db, 2, "succeeded", null, null, 100)).toThrow()

    addRun(db, 1, "succeeded", null, null, 100) // correct: points at the first attempt

    const task = db
      .query<{ attempts: number; cost_cents: number; ever_won: number }, []>(
        `SELECT COUNT(*) AS attempts, SUM(total_cost_cents) AS cost_cents,
                MAX(status='succeeded') AS ever_won
           FROM runs GROUP BY COALESCE(parent_run_id, id)`,
      )
      .all()

    expect(task).toHaveLength(1) // one task, not three
    expect(task[0]!.attempts).toBe(3)
    expect(task[0]!.cost_cents).toBe(600) // failed attempts count toward the cost
    expect(task[0]!.ever_won).toBe(1)
  } finally {
    cleanup()
  }
})

test("a failed run must say what went wrong and whose problem it is", () => {
  const { db, cleanup } = freshDb()
  try {
    seedOrgTeamEngineer(db)
    expect(() => addRun(db, null, "failed", null, null, 100)).toThrow()
    // A cancelled run is nobody's fault, so it carries neither.
    expect(() => addRun(db, null, "cancelled", null, null, 1)).not.toThrow()
  } finally {
    cleanup()
  }
})

test("money is whole cents and never negative", () => {
  const { db, cleanup } = freshDb()
  try {
    seedOrgTeamEngineer(db)
    db.exec(`INSERT INTO budgets (team_id,month,limit_cents,warn_cents,stop_cents,updated_at)
             VALUES (1,'2026-08',180000,144000,180000,'2026-08-01T00:00:00Z')`)
    expect(() =>
      db.exec(`INSERT INTO budgets (team_id,month,limit_cents,warn_cents,stop_cents,updated_at)
               VALUES (1,'2026-09',-1,1,1,'2026-09-01T00:00:00Z')`),
    ).toThrow()
    // One budget per team per month.
    expect(() =>
      db.exec(`INSERT INTO budgets (team_id,month,limit_cents,warn_cents,stop_cents,updated_at)
               VALUES (1,'2026-08',1,1,1,'x')`),
    ).toThrow()
  } finally {
    cleanup()
  }
})
