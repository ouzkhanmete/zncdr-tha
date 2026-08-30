import { expect, test } from "bun:test"
import { SqliteEngineerRepository } from "./engineers.ts"
import { SqliteOrgRepository } from "./orgs.ts"
import { SqliteRunRepository } from "./runs.ts"
import { SqliteTeamRepository } from "./teams.ts"
import { freshDb, runInput, seedBase } from "./test-helpers.ts"

test("writing a run and reading it back gives the same values, cost still an exact integer", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, engineer } = seedBase(db)
    const repo = new SqliteRunRepository(db)
    const created = repo.create(
      runInput({ orgId: org.id, teamId: team.id, engineerId: engineer.id, totalCostCents: 1234 }),
    )

    expect(Number.isInteger(created.totalCostCents)).toBe(true)
    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("a run's task summary round-trips exactly, and stays with its own run, not the default", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    const withSummary = repo.create(
      runInput({ orgId: org.id, teamId: team.id, taskSummary: "Add retry to the payment webhook" }),
    )
    const withDefault = repo.create(runInput({ orgId: org.id, teamId: team.id }))

    expect(repo.findById(withSummary.id)?.taskSummary).toBe("Add retry to the payment webhook")
    expect(repo.findById(withDefault.id)?.taskSummary).toBe("Fix a bug in the checkout flow")
  } finally {
    cleanup()
  }
})

test("reading a run that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteRunRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("a retry chain collapses to one task, with every attempt's cost counted, failed ones included", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    const first = repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        status: "failed",
        failureCause: "tests_failed",
        blame: "task",
        totalCostCents: 200,
        finishedAt: "2026-08-01T09:05:00Z",
      }),
    )
    repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        parentRunId: first.id,
        status: "failed",
        failureCause: "tests_failed",
        blame: "task",
        totalCostCents: 300,
        startedAt: "2026-08-01T09:10:00Z",
        finishedAt: "2026-08-01T09:15:00Z",
      }),
    )
    repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        parentRunId: first.id,
        status: "succeeded",
        totalCostCents: 100,
        startedAt: "2026-08-01T09:20:00Z",
        finishedAt: "2026-08-01T09:25:00Z",
      }),
    )

    const chain = repo.listChainMembers(first.id)
    expect(chain).toHaveLength(3)

    const costs = repo.listFinishedTaskCosts(org.id, {
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-02T00:00:00Z",
    })
    expect(costs).toHaveLength(1)
    expect(costs[0]).toEqual({
      taskId: first.id,
      costCents: 600, // every attempt counted, not just the winner
      attemptCount: 3,
      everSucceeded: true,
    })
  } finally {
    cleanup()
  }
})

test("a retry must point at the first attempt -- the database refuses a chain that would split in two", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    const first = repo.create(runInput({ orgId: org.id, teamId: team.id, status: "failed", failureCause: "tests_failed", blame: "task", totalCostCents: 100 }))
    const second = repo.create(
      runInput({ orgId: org.id, teamId: team.id, parentRunId: first.id, status: "failed", failureCause: "tests_failed", blame: "task", totalCostCents: 100 }),
    )

    expect(() =>
      repo.create(runInput({ orgId: org.id, teamId: team.id, parentRunId: second.id, status: "succeeded", totalCostCents: 100 })),
    ).toThrow()
  } finally {
    cleanup()
  }
})

test("a run still going is left out of anything that counts finished runs", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    const finished = repo.create(
      runInput({ orgId: org.id, teamId: team.id, status: "succeeded", totalCostCents: 500 }),
    )
    const stillGoing = repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        status: "running",
        finishedAt: null,
        durationMs: null,
        totalCostCents: 999_999, // spent so far, but not a finished number
      }),
    )

    const window = { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }

    const finishedCosts = repo.listFinishedTaskCosts(org.id, window)
    expect(finishedCosts.map((c) => c.taskId)).toEqual([finished.id])

    const ended = repo.listEndedRuns(org.id, window)
    expect(ended.map((r) => r.id)).toEqual([finished.id])

    // It isn't just missing -- it shows up in its own "in progress" list, cost and all.
    const running = repo.listRunning(org.id)
    expect(running.map((r) => r.id)).toEqual([stillGoing.id])
    expect(running[0]?.totalCostCents).toBe(999_999)
  } finally {
    cleanup()
  }
})

test("team stamped on a run does not change when the engineer later moves team", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team, engineer } = seedBase(db)
    const teams = new SqliteTeamRepository(db)
    const otherTeam = teams.create({ orgId: org.id, name: "Comet", createdAt: "2026-01-01T00:00:00Z" })

    const runs = new SqliteRunRepository(db)
    const run = runs.create(runInput({ orgId: org.id, teamId: team.id, engineerId: engineer.id }))

    new SqliteEngineerRepository(db).updateTeam(engineer.id, otherTeam.id)

    const reread = runs.findById(run.id)
    expect(reread?.teamId).toBe(team.id) // unchanged, even though the engineer moved on
  } finally {
    cleanup()
  }
})

test("listTaskOutcomesStartedIn anchors on when the task started, keeping a chain that spans midnight together", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    const first = repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        status: "failed",
        failureCause: "tests_failed",
        blame: "task",
        startedAt: "2026-08-01T23:50:00Z",
        finishedAt: "2026-08-01T23:55:00Z",
      }),
    )
    // The retry both starts AND finishes the next day, after the window's `to`.
    repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        parentRunId: first.id,
        status: "succeeded",
        startedAt: "2026-08-02T00:10:00Z",
        finishedAt: "2026-08-02T00:15:00Z",
      }),
    )

    const outcomes = repo.listTaskOutcomesStartedIn(org.id, {
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-02T00:00:00Z", // midnight -- the retry's own timestamps fall outside this
    })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.taskId).toBe(first.id)
    expect(outcomes[0]?.runs).toHaveLength(2) // both attempts still counted as one task
    expect(outcomes[0]?.runs.some((r) => r.status === "succeeded")).toBe(true)
  } finally {
    cleanup()
  }
})

test("listTaskOutcomesStartedIn leaves out a task with no finished attempt yet", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)
    repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        status: "running",
        finishedAt: null,
        durationMs: null,
      }),
    )

    const outcomes = repo.listTaskOutcomesStartedIn(org.id, {
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-02T00:00:00Z",
    })
    expect(outcomes).toHaveLength(0)
  } finally {
    cleanup()
  }
})

test("search pages results and filters by status", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    for (let i = 0; i < 3; i++) {
      repo.create(
        runInput({
          orgId: org.id,
          teamId: team.id,
          status: "succeeded",
          startedAt: `2026-08-01T0${i}:00:00Z`,
        }),
      )
    }
    repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        status: "failed",
        failureCause: "tests_failed",
        blame: "task",
        startedAt: "2026-08-01T09:00:00Z",
      }),
    )

    const window = { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }

    const page1 = repo.search(org.id, window, { limit: 2, offset: 0 })
    expect(page1.total).toBe(4)
    expect(page1.items).toHaveLength(2)

    const page2 = repo.search(org.id, window, { limit: 2, offset: 2 })
    expect(page2.items).toHaveLength(2)

    const onlyFailed = repo.search(org.id, window, { limit: 10, offset: 0, status: "failed" })
    expect(onlyFailed.total).toBe(1)
    expect(onlyFailed.items[0]?.status).toBe("failed")
  } finally {
    cleanup()
  }
})

test("listDailyCostTotals groups by UTC day and counts runs still in progress, unlike listEndedRuns", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const otherTeam = new SqliteTeamRepository(db).create({ orgId: org.id, name: "Comet", createdAt: "2026-01-01T00:00:00Z" })
    const repo = new SqliteRunRepository(db)

    repo.create(
      runInput({ orgId: org.id, teamId: team.id, status: "succeeded", startedAt: "2026-08-01T09:00:00Z", finishedAt: "2026-08-01T09:05:00Z", totalCostCents: 100 }),
    )
    repo.create(
      runInput({ orgId: org.id, teamId: team.id, status: "succeeded", startedAt: "2026-08-01T20:00:00Z", finishedAt: "2026-08-01T20:05:00Z", totalCostCents: 50 }),
    )
    repo.create(
      runInput({ orgId: org.id, teamId: team.id, status: "succeeded", startedAt: "2026-08-02T09:00:00Z", finishedAt: "2026-08-02T09:05:00Z", totalCostCents: 30 }),
    )
    // Still running -- budget spend counts this money as already gone, so it must show up too.
    repo.create(
      runInput({ orgId: org.id, teamId: team.id, status: "running", startedAt: "2026-08-02T10:00:00Z", finishedAt: null, durationMs: null, totalCostCents: 20 }),
    )
    // A different team's spend must not leak into this team's totals.
    repo.create(
      runInput({ orgId: org.id, teamId: otherTeam.id, status: "succeeded", startedAt: "2026-08-01T09:00:00Z", finishedAt: "2026-08-01T09:05:00Z", totalCostCents: 999 }),
    )

    const window = { from: "2026-08-01T00:00:00Z", to: "2026-08-03T00:00:00Z" }
    const totals = repo.listDailyCostTotals(org.id, window, { teamId: team.id })

    expect(totals).toEqual([
      { date: "2026-08-01", costCents: 150 },
      { date: "2026-08-02", costCents: 50 }, // includes the still-running run's 20 cents
    ])
  } finally {
    cleanup()
  }
})

test("listStartedIn returns every run whose own started_at falls in the window, unpaged", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)

    const inWindow1 = repo.create(runInput({ orgId: org.id, teamId: team.id, startedAt: "2026-08-01T09:00:00Z" }))
    const inWindow2 = repo.create(runInput({ orgId: org.id, teamId: team.id, startedAt: "2026-08-01T20:00:00Z", finishedAt: "2026-08-01T20:05:00Z" }))
    // Still going -- listStartedIn isn't restricted to finished runs, unlike listEndedRuns.
    const stillGoing = repo.create(
      runInput({ orgId: org.id, teamId: team.id, startedAt: "2026-08-01T10:00:00Z", status: "running", finishedAt: null, durationMs: null }),
    )
    repo.create(runInput({ orgId: org.id, teamId: team.id, startedAt: "2026-07-31T23:59:59Z", finishedAt: "2026-08-01T00:00:00Z" })) // before the window
    repo.create(runInput({ orgId: org.id, teamId: team.id, startedAt: "2026-08-02T00:00:00Z", finishedAt: "2026-08-02T00:05:00Z" })) // at `to`, excluded

    const started = repo.listStartedIn(org.id, { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" })

    expect(started.map((r) => r.id).sort()).toEqual([inWindow1.id, inWindow2.id, stillGoing.id].sort())
  } finally {
    cleanup()
  }
})

test("everStartedEngineerIds ignores any window, dedupes, drops automation runs, and stays scoped to its org", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const engineerTwo = new SqliteEngineerRepository(db).create({
      orgId: org.id, teamId: team.id, handle: "j.diaz", displayName: "Jamie Diaz",
      seatGrantedAt: "2026-01-01T00:00:00Z", seatActive: true,
    })
    const repo = new SqliteRunRepository(db)

    repo.create(runInput({ orgId: org.id, teamId: team.id, engineerId: engineerTwo.id, startedAt: "2020-01-01T00:00:00Z" }))
    repo.create(runInput({ orgId: org.id, teamId: team.id, engineerId: engineerTwo.id, startedAt: "2026-08-01T00:00:00Z" }))
    repo.create(runInput({ orgId: org.id, teamId: team.id, engineerId: null, startedAt: "2026-08-01T00:00:00Z" })) // automation

    // A second org's engineer runs plenty too -- must not leak into the first org's ids. Built
    // by hand rather than a second `seedBase(db)` call, which would collide on the model row's
    // unique key.
    const otherOrg = new SqliteOrgRepository(db).create({ name: "Globex", licensedSeats: 10, createdAt: "2026-01-01T00:00:00Z" })
    const otherTeam = new SqliteTeamRepository(db).create({ orgId: otherOrg.id, name: "Orbit", createdAt: "2026-01-01T00:00:00Z" })
    const otherEngineer = new SqliteEngineerRepository(db).create({
      orgId: otherOrg.id, teamId: otherTeam.id, handle: "a.kim", displayName: "Alex Kim",
      seatGrantedAt: "2026-01-01T00:00:00Z", seatActive: true,
    })
    repo.create(runInput({ orgId: otherOrg.id, teamId: otherTeam.id, engineerId: otherEngineer.id, startedAt: "2026-08-01T00:00:00Z" }))

    const ids = repo.everStartedEngineerIds(org.id)

    expect(ids).toEqual([engineerTwo.id]) // deduped, no null, the far-past run still counts, no cross-org leak
  } finally {
    cleanup()
  }
})

test("updateRollups keeps the cached totals in step without touching anything else", () => {
  const { db, cleanup } = freshDb()
  try {
    const { org, team } = seedBase(db)
    const repo = new SqliteRunRepository(db)
    const run = repo.create(runInput({ orgId: org.id, teamId: team.id, totalCostCents: 0, turnCount: 0, toolCallCount: 0 }))

    const updated = repo.updateRollups(run.id, { totalCostCents: 450, turnCount: 3, toolCallCount: 5 })
    expect(updated).toEqual({ ...run, totalCostCents: 450, turnCount: 3, toolCallCount: 5 })
  } finally {
    cleanup()
  }
})

test("every list method still works when a filter is actually passed", () => {
  // This is the test that was missing when `listTaskOutcomesStartedIn` shipped broken. Its
  // filter clause named the CTE alias `anchors`, but the clause is injected inside the CTE where
  // the table is still plain `runs` — so ANY filtered call threw "no such column: anchors.
  // engineer_id". It stayed hidden because every test called these methods with no filter at all.
  // Passing a filter is the whole point here; the returned rows matter less than not throwing.
  const { db, cleanup } = freshDb()
  try {
    const { org, team, engineer } = seedBase(db)
    const repo = new SqliteRunRepository(db)
    const first = repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        engineerId: engineer.id,
        status: "failed",
        failureCause: "tests_failed",
        blame: "task",
        startedAt: "2026-08-01T09:00:00Z",
        finishedAt: "2026-08-01T09:05:00Z",
      }),
    )
    repo.create(
      runInput({
        orgId: org.id,
        teamId: team.id,
        engineerId: engineer.id,
        parentRunId: first.id,
        status: "succeeded",
        startedAt: "2026-08-01T09:06:00Z",
        finishedAt: "2026-08-01T09:10:00Z",
      }),
    )

    const window = { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }
    const filters = { teamId: team.id, engineerId: engineer.id, agentKind: "coder" }

    // Each of these injects the same filter clause into a differently shaped query. The one that
    // broke was the only one wrapping its filter in a CTE, so covering them together is the point.
    expect(() => repo.listTaskOutcomesStartedIn(org.id, window, filters)).not.toThrow()
    expect(() => repo.listEndedRuns(org.id, window, filters)).not.toThrow()
    expect(() => repo.listStartedIn(org.id, window, filters)).not.toThrow()
    expect(() => repo.listFinishedTaskCosts(org.id, window, filters)).not.toThrow()
    expect(() => repo.listDailyCostTotals(org.id, window, filters)).not.toThrow()
    expect(() => repo.everStartedEngineerIds(org.id, filters)).not.toThrow()

    // And the filtered result is still correct, not merely non-throwing.
    const outcomes = repo.listTaskOutcomesStartedIn(org.id, window, filters)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.runs).toHaveLength(2)

    // A filter that matches nobody returns nothing, rather than quietly ignoring the filter.
    const otherTeam = new SqliteTeamRepository(db).create({
      orgId: org.id,
      name: "Somebody Else",
      createdAt: "2026-01-01T00:00:00Z",
    })
    expect(repo.listTaskOutcomesStartedIn(org.id, window, { teamId: otherTeam.id })).toHaveLength(0)
  } finally {
    cleanup()
  }
})
