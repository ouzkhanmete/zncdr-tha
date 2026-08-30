import { expect, test } from "bun:test"
import { SqliteOrgRepository } from "./orgs.ts"
import { SqliteTeamRepository } from "./teams.ts"
import { freshDb } from "./test-helpers.ts"

test("writing a team and reading it back gives the same values", () => {
  const { db, cleanup } = freshDb()
  try {
    const org = new SqliteOrgRepository(db).create({
      name: "Acme",
      licensedSeats: 10,
      createdAt: "2026-01-01T00:00:00Z",
    })
    const repo = new SqliteTeamRepository(db)
    const created = repo.create({ orgId: org.id, name: "Nova", createdAt: "2026-01-01T00:00:00Z" })

    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading a team that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteTeamRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("listByOrgId only returns that org's teams", () => {
  const { db, cleanup } = freshDb()
  try {
    const orgs = new SqliteOrgRepository(db)
    const teams = new SqliteTeamRepository(db)
    const orgA = orgs.create({ name: "Acme", licensedSeats: 10, createdAt: "2026-01-01T00:00:00Z" })
    const orgB = orgs.create({ name: "Globex", licensedSeats: 10, createdAt: "2026-01-01T00:00:00Z" })
    const nova = teams.create({ orgId: orgA.id, name: "Nova", createdAt: "2026-01-01T00:00:00Z" })
    teams.create({ orgId: orgB.id, name: "Zenith", createdAt: "2026-01-01T00:00:00Z" })

    expect(teams.listByOrgId(orgA.id)).toEqual([nova])
  } finally {
    cleanup()
  }
})
