import { expect, test } from "bun:test"
import { addRun, freshDb, seedOrgTeamEngineer } from "./test-helpers.ts"

test("foreign keys are enforced, because SQLite does not do it by default", () => {
  const { db, cleanup } = freshDb()
  try {
    seedOrgTeamEngineer(db)
    // parent_run_id 999 does not exist. Postgres would refuse this, so SQLite must too.
    expect(() => addRun(db, 999, "succeeded", null, null, 100)).toThrow()
  } finally {
    cleanup()
  }
})
