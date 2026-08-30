import { expect, test } from "bun:test"
import { SqliteEngineerRepository } from "./engineers.ts"
import { freshDb, seedBase } from "./test-helpers.ts"

test("writing an engineer and reading it back gives the same values, seat_active included", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteEngineerRepository(db)
    const created = repo.create({
      orgId: org.id,
      teamId: team.id,
      handle: "j.doe",
      displayName: "Jamie Doe",
      seatGrantedAt: "2026-02-01T00:00:00Z",
      seatActive: true,
    })

    expect(created.seatActive).toBe(true)
    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("a seat can be nullable of team, and inactive", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org } = seedBase(db)
    const repo = new SqliteEngineerRepository(db)
    const created = repo.create({
      orgId: org.id,
      teamId: null,
      handle: "unassigned",
      displayName: "Not Yet Placed",
      seatGrantedAt: "2026-02-01T00:00:00Z",
      seatActive: false,
    })
    const found = repo.findById(created.id)
    expect(found?.teamId).toBeNull()
    expect(found?.seatActive).toBe(false)
  } finally {
    cleanup()
  }
})

test("reading an engineer that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteEngineerRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("findByHandle looks a person up within their own org", () => {
  const { db, cleanup } = freshDb()
  try {
    const { engineer } = seedBase(db)
    const repo = new SqliteEngineerRepository(db)
    expect(repo.findByHandle(engineer.orgId, engineer.handle)).toEqual(engineer)
    expect(repo.findByHandle(999, engineer.handle)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("listByOrgId and listByTeamId scope correctly", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, engineer } = seedBase(db)
    const repo = new SqliteEngineerRepository(db)
    const other = repo.create({
      orgId: org.id,
      teamId: null,
      handle: "solo",
      displayName: "Solo Act",
      seatGrantedAt: "2026-02-01T00:00:00Z",
      seatActive: true,
    })

    expect(repo.listByOrgId(org.id)).toEqual([engineer, other])
    expect(repo.listByTeamId(team.id)).toEqual([engineer])
  } finally {
    cleanup()
  }
})

test("updateTeam moves a person without touching their past runs (see runs.test.ts)", () => {
  const { db, cleanup } = freshDb()
  try {
    const { team, engineer } = seedBase(db)
    const repo = new SqliteEngineerRepository(db)
    expect(engineer.teamId).toBe(team.id)

    const moved = repo.updateTeam(engineer.id, null)
    expect(moved?.teamId).toBeNull()
    expect(repo.findById(engineer.id)?.teamId).toBeNull()
  } finally {
    cleanup()
  }
})
