import { expect, test } from "bun:test"
import { SqliteOrgRepository } from "./orgs.ts"
import { freshDb } from "./test-helpers.ts"

test("writing an org and reading it back gives the same values", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteOrgRepository(db)
    const created = repo.create({ name: "Acme", licensedSeats: 130, createdAt: "2026-01-01T00:00:00Z" })

    expect(created.id).toBeGreaterThan(0)
    expect(Number.isInteger(created.licensedSeats)).toBe(true)

    const found = repo.findById(created.id)
    expect(found).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading an org that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteOrgRepository(db)
    expect(repo.findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("list returns every org, in id order", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteOrgRepository(db)
    const a = repo.create({ name: "Acme", licensedSeats: 10, createdAt: "2026-01-01T00:00:00Z" })
    const b = repo.create({ name: "Globex", licensedSeats: 20, createdAt: "2026-01-02T00:00:00Z" })
    expect(repo.list()).toEqual([a, b])
  } finally {
    cleanup()
  }
})
