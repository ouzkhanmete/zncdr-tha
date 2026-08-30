import { expect, test } from "bun:test"
import { SqlitePolicyFlagRepository } from "./policy-flags.ts"
import { SqliteRunRepository } from "./runs.ts"
import { SqliteTeamRepository } from "./teams.ts"
import { SqliteTurnRepository } from "./turns.ts"
import { freshDb, runInput, seedBase } from "./test-helpers.ts"

test("writing a policy flag and reading it back gives the same values", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqlitePolicyFlagRepository(db)

    const created = repo.create({
      runId: run.id,
      turnId: null,
      kind: "unsafe_command",
      severity: "high",
      disposition: "confirmed",
      resource: "rm -rf /",
      createdAt: "2026-08-01T09:03:00Z",
    })

    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("a flag tied to a specific turn round-trips that turn's id, not just a run-level null", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const turn = new SqliteTurnRepository(db).create({
      runId: run.id,
      turnIndex: 0,
      modelId: model.id,
      tokensInFresh: 100,
      tokensInCached: 0,
      tokensCacheWrite: 0,
      tokensOut: 50,
      tokensThinking: 0,
      latencyMs: 1_000,
      finishReason: "stop",
      costCents: 10,
      startedAt: "2026-08-01T09:00:00Z",
    })
    const repo = new SqlitePolicyFlagRepository(db)

    const flag = repo.create({
      runId: run.id,
      turnId: turn.id,
      kind: "goal_hijacked",
      severity: "high",
      disposition: "confirmed",
      resource: "ignore prior instructions",
      createdAt: "2026-08-01T09:00:30Z",
    })

    expect(flag.turnId).toBe(turn.id)
    expect(repo.findById(flag.id)?.turnId).toBe(turn.id)
  } finally {
    cleanup()
  }
})

test("listByRunId returns every flag on a turn, not just the first", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, model } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const turn = new SqliteTurnRepository(db).create({
      runId: run.id,
      turnIndex: 0,
      modelId: model.id,
      tokensInFresh: 100,
      tokensInCached: 0,
      tokensCacheWrite: 0,
      tokensOut: 50,
      tokensThinking: 0,
      latencyMs: 1_000,
      finishReason: "stop",
      costCents: 10,
      startedAt: "2026-08-01T09:00:00Z",
    })
    const repo = new SqlitePolicyFlagRepository(db)

    const first = repo.create({ runId: run.id, turnId: turn.id, kind: "unsafe_command", severity: "high", disposition: "confirmed", resource: "rm -rf /", createdAt: "2026-08-01T09:00:10Z" })
    const second = repo.create({ runId: run.id, turnId: turn.id, kind: "secret_exposed", severity: "high", disposition: "confirmed", resource: "AWS_SECRET_ACCESS_KEY", createdAt: "2026-08-01T09:00:20Z" })
    const runLevel = repo.create({ runId: run.id, turnId: null, kind: "spend_cap_crossed", severity: "medium", disposition: "under_review", resource: null, createdAt: "2026-08-01T09:01:00Z" })

    const flags = repo.listByRunId(run.id)
    expect(flags.filter((f) => f.turnId === turn.id)).toEqual([first, second])
    expect(flags.filter((f) => f.turnId === null)).toEqual([runLevel])
  } finally {
    cleanup()
  }
})

test("reading a policy flag that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqlitePolicyFlagRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("severity keeps its own lane -- three flags in one batch come back distinct", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqlitePolicyFlagRepository(db)

    const low = repo.create({ runId: run.id, turnId: null, kind: "blocked_domain_attempt", severity: "low", disposition: "expected_and_dismissed", resource: null, createdAt: "2026-08-01T09:00:00Z" })
    const medium = repo.create({ runId: run.id, turnId: null, kind: "excess_access_requested", severity: "medium", disposition: "under_review", resource: null, createdAt: "2026-08-01T09:00:00Z" })
    const high = repo.create({ runId: run.id, turnId: null, kind: "attempted_exfiltration", severity: "high", disposition: "confirmed", resource: null, createdAt: "2026-08-01T09:00:00Z" })

    const flags = repo.listByRunId(run.id)
    expect(flags).toEqual([low, medium, high])
    expect(new Set(flags.map((f) => f.severity)).size).toBe(3)
  } finally {
    cleanup()
  }
})

test("listCreatedInWindowWithTeam carries the id and name of each flag's team", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const teamB = new SqliteTeamRepository(db).create({ orgId: org.id, name: "Comet", createdAt: "2026-01-01T00:00:00Z" })
    const runs = new SqliteRunRepository(db)
    const flags = new SqlitePolicyFlagRepository(db)

    const runA = runs.create(runInput({ orgId: org.id, teamId: team.id }))
    const runB = runs.create(runInput({ orgId: org.id, teamId: teamB.id }))
    const flagA = flags.create({
      runId: runA.id, turnId: null, kind: "blocked_domain_attempt", severity: "medium",
      disposition: "under_review", resource: null, createdAt: "2026-08-01T09:00:00Z",
    })
    const flagB = flags.create({
      runId: runB.id, turnId: null, kind: "secret_exposed", severity: "high",
      disposition: "confirmed", resource: null, createdAt: "2026-08-01T09:01:00Z",
    })

    const rows = flags.listCreatedInWindowWithTeam(org.id, {
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-02T00:00:00Z",
    })

    expect(rows).toEqual([
      { ...flagA, teamId: team.id, teamName: "Nova" },
      { ...flagB, teamId: teamB.id, teamName: "Comet" },
    ])

    // Scoping to one team drops the other team's flag entirely.
    const scoped = flags.listCreatedInWindowWithTeam(
      org.id,
      { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" },
      { teamId: team.id },
    )
    expect(scoped).toEqual([{ ...flagA, teamId: team.id, teamName: "Nova" }])
  } finally {
    cleanup()
  }
})

test("countPriorByKindForTeam is the building block for ranking a flag as new for a team", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const teamB = new SqliteTeamRepository(db).create({ orgId: org.id, name: "Comet", createdAt: "2026-01-01T00:00:00Z" })
    const runs = new SqliteRunRepository(db)
    const flags = new SqlitePolicyFlagRepository(db)

    const runA = runs.create(runInput({ orgId: org.id, teamId: team.id }))
    for (let i = 0; i < 50; i++) {
      flags.create({
        runId: runA.id, turnId: null, kind: "blocked_domain_attempt", severity: "low",
        disposition: "expected_and_dismissed", resource: null, createdAt: "2026-07-01T00:00:00Z",
      })
    }

    const runB = runs.create(runInput({ orgId: org.id, teamId: teamB.id }))
    flags.create({
      runId: runB.id, turnId: null, kind: "secret_exposed", severity: "high",
      disposition: "confirmed", resource: null, createdAt: "2026-08-01T09:00:00Z",
    })

    // Team A has seen this kind fifty times before today.
    expect(flags.countPriorByKindForTeam(team.id, "blocked_domain_attempt", "2026-08-01T10:00:00Z")).toBe(50)
    // Team B has never seen this kind before the moment it was raised -- it's new for them.
    expect(flags.countPriorByKindForTeam(teamB.id, "secret_exposed", "2026-08-01T09:00:00Z")).toBe(0)
  } finally {
    cleanup()
  }
})

test("listCreatedInWindow joins through the run, since flags carry no org of their own", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const run = new SqliteRunRepository(db).create(runInput({ orgId: org.id, teamId: team.id }))
    const repo = new SqlitePolicyFlagRepository(db)
    const flag = repo.create({
      runId: run.id, turnId: null, kind: "spend_cap_crossed", severity: "medium",
      disposition: "under_review", resource: "monthly-budget", createdAt: "2026-08-01T09:00:00Z",
    })

    expect(
      repo.listCreatedInWindow(org.id, { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }),
    ).toEqual([flag])
    expect(
      repo.listCreatedInWindow(org.id, { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" }),
    ).toEqual([])
  } finally {
    cleanup()
  }
})
