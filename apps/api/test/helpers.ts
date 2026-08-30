// Shared setup for the end-to-end tests -- not itself a test file (bun test only picks up
// `*.test.ts`). Every e2e test file imports `testServer()` and gets back the *same* running
// server and the *same* seeded database, built exactly once no matter how many test files ask
// for it -- "seed a small database once and reuse it" (this build's own brief), extended across
// files rather than just within one.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Server } from "bun"
import { openDatabase } from "../src/db/connect.ts"
import { migrate } from "../src/db/migrate.ts"
import { buildRoutes, buildServices } from "../src/http/app.ts"
import { DEFAULT_SEED } from "../src/seed/config.ts"
import { generateSeedData, type SeedDataset } from "../src/seed/generate/index.ts"
import { loadSeedData } from "../src/seed/insert.ts"

const MIGRATIONS = join(import.meta.dir, "../migrations")

export interface TestServer {
  server: Server
  baseUrl: string
  data: SeedDataset
}

let cached: Promise<TestServer> | null = null

async function start(): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), "agent-analytics-e2e-"))
  const db = openDatabase(join(dir, "test.db"))
  migrate(db, MIGRATIONS)

  // The real generator and the real loader -- the same ones `bun run seed` calls -- so these
  // tests exercise the actual seeded shape of the data (docs/testing.md's one deliberate
  // exception to "tests build their own small, hand-written rows": a smoke check that the real
  // seed data loads and every endpoint answers). Fixed seed, so every run of this suite sees
  // byte-identical rows.
  const data = generateSeedData(DEFAULT_SEED)
  loadSeedData(db, data)

  const services = buildServices(db, data.org.id)
  const server = Bun.serve({
    port: 0,
    routes: buildRoutes(services),
    fetch: () => new Response("Not found", { status: 404 }),
  })

  process.on("exit", () => {
    rmSync(dir, { recursive: true, force: true })
  })

  return { server, baseUrl: server.url.toString().replace(/\/$/, ""), data }
}

/** Starts the server the first time this is called; every later call (from any test file) gets
 *  back the exact same instance. */
export function testServer(): Promise<TestServer> {
  if (!cached) cached = start()
  return cached
}

export async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const { baseUrl } = await testServer()
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, body: await res.json() }
}

export async function putJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const { baseUrl } = await testServer()
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

/** Every number `path` reaches into an object is a whole number of cents -- money never a float,
 *  docs/api.md's "Money is a whole number of cents." Walks the whole reply once rather than
 *  naming every money field by hand, so a new money field added later is covered automatically. */
export function everyCentsFieldIsAnInteger(value: unknown, path: string[] = []): string[] {
  const problems: string[] = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => problems.push(...everyCentsFieldIsAnInteger(v, [...path, String(i)])))
    return problems
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key.toLowerCase().endsWith("cents") && typeof v === "number" && !Number.isInteger(v)) {
        problems.push([...path, key].join("."))
      }
      problems.push(...everyCentsFieldIsAnInteger(v, [...path, key]))
    }
  }
  return problems
}
