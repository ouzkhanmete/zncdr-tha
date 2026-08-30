import { expect, test } from "bun:test"
import { SqliteBudgetRepository } from "./budgets.ts"
import { SqliteTeamRepository } from "./teams.ts"
import { freshDb, seedBase } from "./test-helpers.ts"

test("writing a budget and reading it back gives the same values, every line an exact integer", () => {
  const { db, cleanup } = freshDb()
  try {
    const { team } = seedBase(db)
    const repo = new SqliteBudgetRepository(db)
    const created = repo.upsert({
      teamId: team.id,
      month: "2026-08",
      limitCents: 180_000,
      warnCents: 144_000,
      stopCents: 180_000,
      updatedAt: "2026-08-01T00:00:00Z",
    })

    expect(Number.isInteger(created.limitCents)).toBe(true)
    expect(repo.findByTeamAndMonth(team.id, "2026-08")).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading a budget that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteBudgetRepository(db)
    expect(repo.findById(999)).toBeUndefined()
    expect(repo.findByTeamAndMonth(1, "2026-08")).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("upsert replaces the existing month's budget instead of adding a second row", () => {
  const { db, cleanup } = freshDb()
  try {
    const { team } = seedBase(db)
    const repo = new SqliteBudgetRepository(db)
    const first = repo.upsert({
      teamId: team.id, month: "2026-08", limitCents: 100_000, warnCents: 80_000,
      stopCents: 100_000, updatedAt: "2026-08-01T00:00:00Z",
    })
    const second = repo.upsert({
      teamId: team.id, month: "2026-08", limitCents: 200_000, warnCents: 160_000,
      stopCents: 200_000, updatedAt: "2026-08-15T00:00:00Z",
    })

    expect(second.id).toBe(first.id) // same row, replaced -- not a new one
    expect(repo.findByTeamAndMonth(team.id, "2026-08")).toEqual(second)
  } finally {
    cleanup()
  }
})

test("a budget's lines have to make sense together -- the database refuses stop above limit", () => {
  const { db, cleanup } = freshDb()
  try {
    const { team } = seedBase(db)
    const repo = new SqliteBudgetRepository(db)
    expect(() =>
      repo.upsert({
        teamId: team.id, month: "2026-08", limitCents: 100, warnCents: 50,
        stopCents: 999, updatedAt: "2026-08-01T00:00:00Z",
      }),
    ).toThrow()
  } finally {
    cleanup()
  }
})

test("listByOrgAndMonth adds up every team's budget for a month, joined through the team", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const teamB = new SqliteTeamRepository(db).create({ orgId: org.id, name: "Comet", createdAt: "2026-01-01T00:00:00Z" })
    const repo = new SqliteBudgetRepository(db)
    const a = repo.upsert({ teamId: team.id, month: "2026-08", limitCents: 1000, warnCents: 800, stopCents: 1000, updatedAt: "2026-08-01T00:00:00Z" })
    const b = repo.upsert({ teamId: teamB.id, month: "2026-08", limitCents: 2000, warnCents: 1600, stopCents: 2000, updatedAt: "2026-08-01T00:00:00Z" })
    // A different month shouldn't show up.
    repo.upsert({ teamId: team.id, month: "2026-09", limitCents: 1000, warnCents: 800, stopCents: 1000, updatedAt: "2026-09-01T00:00:00Z" })

    expect(repo.listByOrgAndMonth(org.id, "2026-08")).toEqual([a, b])
  } finally {
    cleanup()
  }
})
