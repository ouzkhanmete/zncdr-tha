import { expect, test } from "bun:test"
import { SqliteArtifactRepository } from "./artifacts.ts"
import { SqliteRunRepository } from "./runs.ts"
import { freshDb, runInput, seedBase } from "./test-helpers.ts"

test("writing an artifact and reading it back gives the same values", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqliteArtifactRepository(db)

    const created = repo.create({
      runId: run.id,
      kind: "pull_request",
      ref: "https://example.com/pr/1",
      createdAt: "2026-08-01T09:05:00Z",
      mergedAt: null,
      revertedAt: null,
    })

    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading an artifact that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteArtifactRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("a revert can only be recorded once a merge is -- the database refuses one without it", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqliteArtifactRepository(db)

    expect(() =>
      repo.create({
        runId: run.id, kind: "pull_request", ref: "https://example.com/pr/2",
        createdAt: "2026-08-01T09:05:00Z", mergedAt: null, revertedAt: "2026-08-05T00:00:00Z",
      }),
    ).toThrow()
  } finally {
    cleanup()
  }
})

test("listPrimaryKindByRunIds picks the earliest artifact per run, and skips runs with none", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const runs = new SqliteRunRepository(db)
    const repo = new SqliteArtifactRepository(db)

    const oneArtifact = runs.create(runInput({ orgId: org.id, teamId: team.id }))
    repo.create({
      runId: oneArtifact.id, kind: "commit", ref: "abc1234",
      createdAt: "2026-08-01T09:05:00Z", mergedAt: null, revertedAt: null,
    })

    // Two artifacts on the same run -- the pull request was opened after the commit, so the
    // commit is the earliest and must win.
    const twoArtifacts = runs.create(runInput({ orgId: org.id, teamId: team.id }))
    repo.create({
      runId: twoArtifacts.id, kind: "pull_request", ref: "#42",
      createdAt: "2026-08-01T09:10:00Z", mergedAt: null, revertedAt: null,
    })
    repo.create({
      runId: twoArtifacts.id, kind: "commit", ref: "def5678",
      createdAt: "2026-08-01T09:06:00Z", mergedAt: null, revertedAt: null,
    })

    const noArtifacts = runs.create(runInput({ orgId: org.id, teamId: team.id, status: "failed", failureCause: "tests_failed", blame: "task" }))

    const kinds = repo.listPrimaryKindByRunIds([oneArtifact.id, twoArtifacts.id, noArtifacts.id])

    expect(kinds.get(oneArtifact.id)).toBe("commit")
    expect(kinds.get(twoArtifacts.id)).toBe("commit")
    expect(kinds.has(noArtifacts.id)).toBe(false)
  } finally {
    cleanup()
  }
})

test("listPrimaryKindByRunIds returns an empty map for an empty list, not a SQL error", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteArtifactRepository(db).listPrimaryKindByRunIds([])).toEqual(new Map())
  } finally {
    cleanup()
  }
})

test("listMergedInWindow goes by when a change merged, not when it was created", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqliteArtifactRepository(db)

    // Opened well before the window, but merged inside it -- real merged work in this window,
    // and must be counted even though `listCreatedInWindow` would never see it.
    const createdBeforeMergedInside = repo.create({
      runId: run.id, kind: "pull_request", ref: "https://example.com/pr/10",
      createdAt: "2026-07-20T00:00:00Z", mergedAt: "2026-08-01T12:00:00Z", revertedAt: null,
    })
    // Merged before the window opened -- not part of this window's merged work, even though it
    // was also created before the window.
    repo.create({
      runId: run.id, kind: "pull_request", ref: "https://example.com/pr/11",
      createdAt: "2026-07-10T00:00:00Z", mergedAt: "2026-07-25T00:00:00Z", revertedAt: null,
    })
    // Created inside the window, but never merged -- listCreatedInWindow's job, not this one's.
    repo.create({
      runId: run.id, kind: "pull_request", ref: "https://example.com/pr/12",
      createdAt: "2026-08-05T00:00:00Z", mergedAt: null, revertedAt: null,
    })

    const merged = repo.listMergedInWindow(org.id, { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

    expect(merged).toEqual([createdBeforeMergedInside])
  } finally {
    cleanup()
  }
})

test("listByRunId and listCreatedInWindow, scoped through the run's org and team", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqliteArtifactRepository(db)
    const pr = repo.create({
      runId: run.id, kind: "pull_request", ref: "https://example.com/pr/3",
      createdAt: "2026-08-01T09:05:00Z", mergedAt: "2026-08-02T00:00:00Z", revertedAt: null,
    })

    expect(repo.listByRunId(run.id)).toEqual([pr])
    expect(
      repo.listCreatedInWindow(org.id, { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }, {
        teamId: team.id,
      }),
    ).toEqual([pr])
    expect(
      repo.listCreatedInWindow(org.id, { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" }),
    ).toEqual([])
  } finally {
    cleanup()
  }
})
