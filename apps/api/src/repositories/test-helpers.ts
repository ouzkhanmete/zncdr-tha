// Shared setup for repository tests. Not itself a test file -- bun test only picks up
// `*.test.ts`, so this can hold plain helpers without being run as a suite of its own.

import type { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Run } from "@app/shared"
import { openDatabase } from "../db/connect.ts"
import { migrate } from "../db/migrate.ts"
import { SqliteEngineerRepository } from "./engineers.ts"
import { SqliteModelRepository } from "./models.ts"
import { SqliteOrgRepository } from "./orgs.ts"
import { SqliteTeamRepository } from "./teams.ts"

const MIGRATIONS = join(import.meta.dir, "../../migrations")

/** A real database on disk, built from the real migration files -- never a hand-copied schema,
 *  so a broken migration cannot hide behind a passing test. Matches the shape of
 *  src/db/db.test.ts's own `freshDb`. */
export function freshDb(): { db: Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "agent-analytics-repo-"))
  const db = openDatabase(join(dir, "test.db"))
  migrate(db, MIGRATIONS)
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** One org, one team, one engineer on that team, and one priced model -- the minimum every other
 *  table's rows need to point at. Built through the real repositories, so a bug in `create()`
 *  would show up here too. */
export function seedBase(db: Database) {
  const org = new SqliteOrgRepository(db).create({
    name: "Acme",
    licensedSeats: 130,
    createdAt: "2026-01-01T00:00:00Z",
  })
  const team = new SqliteTeamRepository(db).create({
    orgId: org.id,
    name: "Nova",
    createdAt: "2026-01-01T00:00:00Z",
  })
  const engineer = new SqliteEngineerRepository(db).create({
    orgId: org.id,
    teamId: team.id,
    handle: "p.nair",
    displayName: "Priya Nair",
    seatGrantedAt: "2026-01-01T00:00:00Z",
    seatActive: true,
  })
  const model = new SqliteModelRepository(db).create({
    provider: "anthropic",
    name: "test-model",
    inputPricePerMtokCents: 300,
    cachedInputPricePerMtokCents: 30,
    cacheWritePricePerMtokCents: 375,
    outputPricePerMtokCents: 1500,
    effectiveFrom: "2026-01-01T00:00:00Z",
  })
  return { org, team, engineer, model }
}

/** A finished, successful run with sane defaults for every required column -- pass only the
 *  fields a given test actually cares about. */
export function runInput(
  overrides: Partial<Omit<Run, "id">> & { orgId: number; teamId: number },
): Omit<Run, "id"> {
  return {
    engineerId: null,
    parentRunId: null,
    agentKind: "coder",
    trigger: "person",
    repo: null,
    branch: null,
    startedAt: "2026-08-01T09:00:00Z",
    actorUtcOffsetMinutes: 0,
    finishedAt: "2026-08-01T09:05:00Z",
    status: "succeeded",
    failureCause: null,
    blame: null,
    isQuietFailure: false,
    durationMs: 300_000,
    totalCostCents: 0,
    turnCount: 0,
    toolCallCount: 0,
    taskSummary: "Fix a bug in the checkout flow",
    ...overrides,
  }
}
