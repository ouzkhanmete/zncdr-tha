// Shared setup for seed tests. Not itself a test file -- bun test only picks up
// `*.test.ts`, so this can hold plain helpers without being run as a suite of its own.

import type { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../db/connect.ts"
import { migrate } from "../db/migrate.ts"
import { DEFAULT_SEED } from "./config.ts"
import { generateSeedData, type SeedDataset } from "./generate/index.ts"
import { loadSeedData } from "./insert.ts"

const MIGRATIONS = join(import.meta.dir, "../../migrations")

/**
 * The full 180-day dataset builds and loads in well under a second (see the timings `bun run
 * seed` prints), so each seed test file builds one real, temporary SQLite file -- from the
 * actual migration files, never a hand-copied schema -- once, and every test in it reads from
 * that same database and dataset.
 */
export function buildSeededDb(): { db: Database; data: SeedDataset; cleanup: () => void } {
  const data = generateSeedData(DEFAULT_SEED)
  const dir = mkdtempSync(join(tmpdir(), "agent-analytics-seed-"))
  const db = openDatabase(join(dir, "test.db"))
  migrate(db, MIGRATIONS)
  // Must not throw: every row the generator produced has to satisfy every CHECK constraint and
  // the runs_parent_must_be_first trigger, the same as it would against a real database.
  loadSeedData(db, data)
  return { db, data, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
