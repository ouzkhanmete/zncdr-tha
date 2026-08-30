import { expect, test } from "bun:test"
import type { Run, Team } from "@app/shared"
import type { FinishedTaskCost, RunFilters, RunRepository, RunSearchResult, TaskOutcome } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"
import type { DateWindow } from "../repositories/types.ts"
import { ComparisonService } from "./comparison.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

function matchesFilters(run: Run, filters?: RunFilters): boolean {
  if (!filters) return true
  if (filters.teamId !== undefined && run.teamId !== filters.teamId) return false
  if (filters.agentKind !== undefined && run.agentKind !== filters.agentKind) return false
  return true
}

/** Every run pre-baked as "ended" -- this test only exercises the rate/band arithmetic, not
 *  window or chain-collapsing logic (already covered by the repository's own tests). */
function fakeRunRepo(runs: readonly Run[]): RunRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    updateRollups: notImplemented("updateRollups"),
    listChainMembers: notImplemented("listChainMembers"),
    listRunning: notImplemented("listRunning"),
    listDailyCostTotals: notImplemented("listDailyCostTotals"),
    search: notImplemented("search") as unknown as (
      orgId: number,
      window: DateWindow,
      filters: RunFilters & { limit: number; offset: number },
    ) => RunSearchResult,
    listFinishedTaskCosts: notImplemented("listFinishedTaskCosts") as unknown as (
      orgId: number,
      window: DateWindow,
      filters?: RunFilters,
    ) => FinishedTaskCost[],
    listStartedIn: notImplemented("listStartedIn"),
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),
    listEndedRuns: (_orgId: number, _window: DateWindow, filters?: RunFilters) => runs.filter((r) => matchesFilters(r, filters)),
    listTaskOutcomesStartedIn: (_orgId: number, _window: DateWindow, filters?: RunFilters): TaskOutcome[] => {
      const byTask = new Map<number, Run[]>()
      for (const r of runs.filter((r) => matchesFilters(r, filters))) {
        const taskId = r.parentRunId ?? r.id
        byTask.set(taskId, [...(byTask.get(taskId) ?? []), r])
      }
      return [...byTask.entries()].map(([taskId, members]) => ({ taskId, runs: members }))
    },
  }
}

function fakeTeamRepo(teams: Team[]): TeamRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listByOrgId: () => teams,
  }
}

function makeRun(overrides: Partial<Run> & { id: number; teamId: number }): Run {
  return {
    orgId: 1,
    engineerId: null,
    parentRunId: null,
    agentKind: "code-fix",
    trigger: "person",
    repo: null,
    branch: null,
    startedAt: "2026-08-01T09:00:00Z",
    actorUtcOffsetMinutes: 0,
    finishedAt: "2026-08-01T09:05:00Z",
    status: "succeeded",
    failureCause: null,
    blame: null,
    isQuietFailure: false,
    durationMs: 300_000,
    totalCostCents: 100,
    turnCount: 1,
    toolCallCount: 0,
    taskSummary: "x",
    ...overrides,
  }
}

const WINDOW: DateWindow = { from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z" }

test("rate always carries the run count it was worked out from, for both team and org", () => {
  const runs = [
    makeRun({ id: 1, teamId: 7, status: "succeeded" }),
    makeRun({ id: 2, teamId: 7, status: "succeeded" }),
    makeRun({ id: 3, teamId: 7, status: "failed", failureCause: "tests_failed", blame: "task" }),
    makeRun({ id: 4, teamId: 9, status: "succeeded" }),
  ]
  const comparison = new ComparisonService(fakeRunRepo(runs), fakeTeamRepo([]))
  const result = comparison.getTeamComparison(1, 7, WINDOW, "firstTry")

  expect(result.team).toEqual({ rate: 2 / 3, runCount: 3 })
  expect(result.org).toEqual({ rate: 3 / 4, runCount: 4 })
  expect(result.note).toBe("the band is the range you'd expect from luck alone, given how many runs this team has done.")
})

test("band shrinks as a team's own run count grows, for the same underlying rate", () => {
  // Both teams run at the org's exact rate (90%) -- only their run counts differ.
  const smallTeamRuns = [
    makeRun({ id: 1, teamId: 1, status: "succeeded" }),
    makeRun({ id: 2, teamId: 1, status: "succeeded" }),
    makeRun({ id: 3, teamId: 1, status: "succeeded" }),
    makeRun({ id: 4, teamId: 1, status: "succeeded" }),
    makeRun({ id: 5, teamId: 1, status: "failed", failureCause: "tests_failed", blame: "task" }),
  ]
  const orgRuns = [...smallTeamRuns.map((r) => ({ ...r, teamId: 999 }))]
  // A 500-run team at the same 90% rate, plus the small team folded into the org population.
  for (let i = 100; i < 600; i++) {
    orgRuns.push(makeRun({ id: i, teamId: 2, status: i % 10 === 0 ? "failed" : "succeeded", failureCause: i % 10 === 0 ? "tests_failed" : null, blame: i % 10 === 0 ? "task" : null }))
  }
  const bigTeamRuns = orgRuns.filter((r) => r.teamId === 2)

  const comparison = new ComparisonService(fakeRunRepo([...smallTeamRuns, ...orgRuns]), fakeTeamRepo([]))
  const small = comparison.getTeamComparison(1, 1, WINDOW, "firstTry")
  const big = comparison.getTeamComparison(1, 2, WINDOW, "firstTry")

  const smallWidth = small.band.high - small.band.low
  const bigWidth = big.band.high - big.band.low
  expect(bigTeamRuns.length).toBeGreaterThan(small.team.runCount)
  expect(bigWidth).toBeLessThan(smallWidth)
})

test("a team sitting inside its band is not flagged; one sitting far outside it is", () => {
  // A big background population at 90% success -- the org's own rate is close to 90% because
  // almost every run in it comes from here, not from either team actually being compared.
  const restOfOrgRuns = Array.from({ length: 5_000 }, (_, i) =>
    makeRun({ id: 2_000 + i, teamId: 3, status: i % 10 === 0 ? "failed" : "succeeded", failureCause: i % 10 === 0 ? "tests_failed" : null, blame: i % 10 === 0 ? "task" : null }),
  )
  // This team's own rate (90%) matches the org closely -- squarely inside its own band.
  const consistentTeamRuns = Array.from({ length: 200 }, (_, i) =>
    makeRun({ id: i + 1, teamId: 1, status: i % 10 === 0 ? "failed" : "succeeded", failureCause: i % 10 === 0 ? "tests_failed" : null, blame: i % 10 === 0 ? "task" : null }),
  )
  // This team is at 10% off the same sample size -- nowhere near the org's ~90%, and with enough
  // runs that the gap can't be chalked up to luck.
  const outlierTeamRuns = Array.from({ length: 200 }, (_, i) =>
    makeRun({ id: 1_000 + i, teamId: 2, status: i % 10 === 0 ? "succeeded" : "failed", failureCause: i % 10 === 0 ? null : "tests_failed", blame: i % 10 === 0 ? null : "task" }),
  )
  const comparison = new ComparisonService(fakeRunRepo([...restOfOrgRuns, ...consistentTeamRuns, ...outlierTeamRuns]), fakeTeamRepo([]))

  const consistent = comparison.getTeamComparison(1, 1, WINDOW, "firstTry")
  const outlier = comparison.getTeamComparison(1, 2, WINDOW, "firstTry")

  expect(consistent.withinBand).toBe(true)
  expect(outlier.withinBand).toBe(false)
})

test("teams comparison lists every team against the same org band, each sized to its own run count", () => {
  const teamA: Team = { id: 1, orgId: 1, name: "Comet", createdAt: "2026-01-01T00:00:00Z" }
  const teamB: Team = { id: 2, orgId: 1, name: "Anchor", createdAt: "2026-01-01T00:00:00Z" }
  const runs = [
    makeRun({ id: 1, teamId: 1, status: "succeeded" }),
    makeRun({ id: 2, teamId: 2, status: "succeeded" }),
    makeRun({ id: 3, teamId: 2, status: "failed", failureCause: "tests_failed", blame: "task" }),
  ]
  const comparison = new ComparisonService(fakeRunRepo(runs), fakeTeamRepo([teamA, teamB]))
  const result = comparison.getTeamsComparison(1, WINDOW, "firstTry")

  expect(result.org.runCount).toBe(3)
  expect(result.teams).toEqual([
    { teamId: 1, teamName: "Comet", rate: 1, runCount: 1, band: expect.any(Object), withinBand: expect.any(Boolean) },
    { teamId: 2, teamName: "Anchor", rate: 0.5, runCount: 2, band: expect.any(Object), withinBand: expect.any(Boolean) },
  ])
})

test("eventual metric counts tasks, not raw runs -- a two-attempt task is one task", () => {
  const runs = [
    makeRun({ id: 1, teamId: 1, parentRunId: null, status: "failed", failureCause: "tests_failed", blame: "task" }),
    makeRun({ id: 2, teamId: 1, parentRunId: 1, status: "succeeded" }),
    makeRun({ id: 3, teamId: 1, parentRunId: null, status: "succeeded" }),
  ]
  const comparison = new ComparisonService(fakeRunRepo(runs), fakeTeamRepo([]))
  const result = comparison.getTeamComparison(1, 1, WINDOW, "eventual")
  expect(result.team).toEqual({ rate: 1, runCount: 2 })
})
