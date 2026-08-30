import { expect, test } from "bun:test"
import { SqliteRunRepository } from "./runs.ts"
import { freshDb, runInput, seedBase } from "./test-helpers.ts"
import { SqliteTurnRepository } from "./turns.ts"

test("writing a turn and reading it back gives the same values, cost still an exact integer", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqliteTurnRepository(db)

    const created = repo.create({
      runId: run.id,
      turnIndex: 0,
      modelId: model.id,
      tokensInFresh: 1000,
      tokensInCached: 500,
      tokensCacheWrite: 200,
      tokensOut: 300,
      tokensThinking: 150,
      latencyMs: 2400,
      finishReason: "stop",
      costCents: 77,
      startedAt: "2026-08-01T09:00:00Z",
    })

    expect(Number.isInteger(created.costCents)).toBe(true)
    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading a turn that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteTurnRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("listByRunId returns a run's turns in order", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqliteTurnRepository(db)
    const second = repo.create({
      runId: run.id, turnIndex: 1, modelId: model.id, tokensInFresh: 1, tokensInCached: 0,
      tokensCacheWrite: 0, tokensOut: 1, tokensThinking: 0, latencyMs: 10, finishReason: "stop",
      costCents: 1, startedAt: "2026-08-01T09:01:00Z",
    })
    const first = repo.create({
      runId: run.id, turnIndex: 0, modelId: model.id, tokensInFresh: 1, tokensInCached: 0,
      tokensCacheWrite: 0, tokensOut: 1, tokensThinking: 0, latencyMs: 10, finishReason: "stop",
      costCents: 1, startedAt: "2026-08-01T09:00:00Z",
    })

    expect(repo.listByRunId(run.id)).toEqual([first, second])
  } finally {
    cleanup()
  }
})

test("listStartedInWindow finds turns by joining through the run, since turns carry no org of their own", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const runs = new SqliteRunRepository(db)
    const inWindow = runs.create(runInput({ orgId: org.id, teamId: team.id }))
    const otherOrgRun = runs.create(
      runInput({ orgId: org.id, teamId: team.id, startedAt: "2020-01-01T00:00:00Z", finishedAt: "2020-01-01T00:05:00Z" }),
    )

    const repo = new SqliteTurnRepository(db)
    const wanted = repo.create({
      runId: inWindow.id, turnIndex: 0, modelId: model.id, tokensInFresh: 1, tokensInCached: 0,
      tokensCacheWrite: 0, tokensOut: 1, tokensThinking: 0, latencyMs: 10, finishReason: "stop",
      costCents: 1, startedAt: "2026-08-01T09:00:00Z",
    })
    repo.create({
      runId: otherOrgRun.id, turnIndex: 0, modelId: model.id, tokensInFresh: 1, tokensInCached: 0,
      tokensCacheWrite: 0, tokensOut: 1, tokensThinking: 0, latencyMs: 10, finishReason: "stop",
      costCents: 1, startedAt: "2020-01-01T00:00:00Z",
    })

    const found = repo.listStartedInWindow(org.id, {
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-02T00:00:00Z",
    })
    expect(found).toEqual([wanted])
  } finally {
    cleanup()
  }
})
