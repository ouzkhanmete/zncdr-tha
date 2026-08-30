import { expect, test } from "bun:test"
import { SqliteRunRepository } from "./runs.ts"
import { freshDb, runInput, seedBase } from "./test-helpers.ts"
import { SqliteToolCallRepository } from "./tool-calls.ts"
import { SqliteTurnRepository } from "./turns.ts"

function makeTurn(db: ReturnType<typeof freshDb>["db"], runId: number, modelId: number) {
  return new SqliteTurnRepository(db).create({
    runId, turnIndex: 0, modelId, tokensInFresh: 1, tokensInCached: 0, tokensCacheWrite: 0,
    tokensOut: 1, tokensThinking: 0, latencyMs: 10, finishReason: "tool_call", costCents: 1,
    startedAt: "2026-08-01T09:00:00Z",
  })
}

test("writing a tool call and reading it back gives the same values, cost still an exact integer", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const turn = makeTurn(db, run.id, model.id)
    const repo = new SqliteToolCallRepository(db)

    const created = repo.create({
      runId: run.id,
      turnId: turn.id,
      toolName: "bash",
      durationMs: 1500,
      outcome: "success",
      target: "ls -la",
      errorType: null,
      costCents: 0,
    })

    expect(Number.isInteger(created.costCents)).toBe(true)
    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading a tool call that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteToolCallRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("an error outcome must carry an error type -- the database refuses one without it", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const turn = makeTurn(db, run.id, model.id)
    const repo = new SqliteToolCallRepository(db)

    expect(() =>
      repo.create({
        runId: run.id, turnId: turn.id, toolName: "curl", durationMs: 10,
        outcome: "error", target: null, errorType: null, costCents: 0,
      }),
    ).toThrow()
  } finally {
    cleanup()
  }
})

test("listByRunId and listByTurnId scope correctly", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const turn = makeTurn(db, run.id, model.id)
    const repo = new SqliteToolCallRepository(db)
    const call = repo.create({
      runId: run.id, turnId: turn.id, toolName: "bash", durationMs: 5,
      outcome: "success", target: null, errorType: null, costCents: 0,
    })

    expect(repo.listByRunId(run.id)).toEqual([call])
    expect(repo.listByTurnId(turn.id)).toEqual([call])
  } finally {
    cleanup()
  }
})
