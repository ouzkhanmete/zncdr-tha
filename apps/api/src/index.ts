/**
 * Wires the whole service together: opens the database, runs every migration, finds the org
 * `bun run seed` created, and serves. `buildServices` (in `http/app.ts`) is where a repository,
 * a service, and a controller actually meet -- docs/architecture.md's "each layer gets what it
 * needs through its constructor," one level up -- shared with the end-to-end tests so both run
 * the exact same wiring against a real database.
 */

import { join } from "node:path"
import { openDatabase } from "./db/connect.ts"
import { migrate } from "./db/migrate.ts"
import { buildRoutes, buildServices } from "./http/app.ts"
import { internalError } from "./http/respond.ts"
import { SqliteOrgRepository } from "./repositories/orgs.ts"

const dbPath = process.env.DB_PATH ?? join(import.meta.dir, "../data.db")
const migrationsDir = join(import.meta.dir, "../migrations")

const db = openDatabase(dbPath)
migrate(db, migrationsDir)

// One org, no login -- docs/architecture.md: "No login and no permissions. One reviewer looks at
// this at a time." Every endpoint answers for whichever org `bun run seed` created.
const org = new SqliteOrgRepository(db).list()[0]
if (!org) {
  console.error("No org found. Run `bun run seed` first to fill the database.")
  process.exit(1)
}

const services = buildServices(db, org.id)
const port = Number(process.env.PORT ?? 3001)

const server = Bun.serve({
  port,
  routes: buildRoutes(services),
  // Anything that doesn't match a route above -- not a 500, just a plain 404. The routes object
  // covers every path in docs/api.md; reaching here means the path itself is wrong, which isn't
  // any of the four error codes docs/api.md section 8 defines for a real endpoint.
  fetch() {
    return new Response("Not found", { status: 404 })
  },
  error(err) {
    console.error("[api] server error", err)
    return internalError()
  },
})

console.log(`api listening on ${server.url}`)
