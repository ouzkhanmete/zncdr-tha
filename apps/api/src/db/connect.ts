import { Database } from "bun:sqlite"

/**
 * The only place a database connection is made.
 *
 * Every connection has to be set up the same way, so nothing else calls `new Database`.
 */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true })

  // SQLite starts with foreign keys switched OFF, and the setting belongs to the connection
  // rather than to the file. Miss this and orphan rows are accepted without complaint —
  // then the same code fails the moment it meets a real Postgres, which always enforces them.
  db.exec("PRAGMA foreign_keys = ON")

  // Readers don't block the writer. Matters once the web app is polling while a seed runs.
  db.exec("PRAGMA journal_mode = WAL")

  // Wait rather than fail instantly if another connection holds the write lock.
  db.exec("PRAGMA busy_timeout = 5000")

  return db
}
