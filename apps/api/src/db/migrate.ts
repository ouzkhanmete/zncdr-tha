import type { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Runs the numbered .sql files in order, skipping ones already applied.
 *
 * Forward only. To change the schema, add a new file — never edit an old one, because
 * a database that already ran it will never see the edit.
 */
export function migrate(db: Database, dir: string): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  )

  const alreadyDone = new Set(
    db.query<{ name: string }, []>("SELECT name FROM schema_migrations").all().map((r) => r.name),
  )

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  const applied: string[] = []
  for (const file of files) {
    if (alreadyDone.has(file)) continue
    const sql = readFileSync(join(dir, file), "utf8")

    // Each file lands whole or not at all, so a broken file can't leave a half-built schema.
    db.transaction(() => {
      db.exec(sql)
      db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString(),
      )
    })()

    applied.push(file)
  }
  return applied
}
