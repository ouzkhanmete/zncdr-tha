import { expect, test } from "bun:test"
import type { Engineer, Run, Team } from "@app/shared"
import type { EngineerRepository } from "../repositories/engineers.ts"
import type { RunRepository } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"
import { LookupService } from "./lookup.ts"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

function fakeTeamRepo(teams: Team[]): TeamRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    listByOrgId: () => teams,
  }
}

function fakeEngineerRepo(byTeam: Record<number, Engineer[]>): EngineerRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    findByHandle: notImplemented("findByHandle"),
    updateTeam: notImplemented("updateTeam"),
    listByOrgId: notImplemented("listByOrgId"),
    listByTeamId: (teamId) => byTeam[teamId] ?? [],
  }
}

function fakeRunRepo(agentKinds: string[]): RunRepository {
  const items = agentKinds.map((agentKind, i) => makeRun(i + 1, agentKind))
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    updateRollups: notImplemented("updateRollups"),
    listChainMembers: notImplemented("listChainMembers"),
    listFinishedTaskCosts: notImplemented("listFinishedTaskCosts"),
    listEndedRuns: notImplemented("listEndedRuns"),
    listTaskOutcomesStartedIn: notImplemented("listTaskOutcomesStartedIn"),
    listRunning: notImplemented("listRunning"),
    listDailyCostTotals: notImplemented("listDailyCostTotals"),
    search: notImplemented("search") as unknown as RunRepository["search"],
    everStartedEngineerIds: notImplemented("everStartedEngineerIds"),
    listStartedIn: () => items,
  }
}

function makeRun(id: number, agentKind: string): Run {
  return {
    id,
    orgId: 1,
    teamId: 1,
    engineerId: null,
    parentRunId: null,
    agentKind,
    trigger: "person",
    repo: null,
    branch: null,
    startedAt: "2026-08-01T00:00:00Z",
    actorUtcOffsetMinutes: 0,
    finishedAt: "2026-08-01T00:05:00Z",
    status: "succeeded",
    failureCause: null,
    blame: null,
    isQuietFailure: false,
    durationMs: 300_000,
    totalCostCents: 0,
    turnCount: 0,
    toolCallCount: 0,
    taskSummary: "x",
  }
}

test("agentKinds is every distinct kind ever run, org-wide, deduplicated and sorted", () => {
  const lookup = new LookupService(
    fakeTeamRepo([]),
    fakeEngineerRepo({}),
    fakeRunRepo(["code-fix", "triage", "code-fix", "report"]),
  )
  const options = lookup.getFilterOptions(1)
  expect(options.agentKinds).toEqual(["code-fix", "report", "triage"])
})

test("engineers is empty when no team is given, and that team's roster when one is", () => {
  const nova: Team = { id: 7, orgId: 1, name: "Nova", createdAt: "2026-01-01T00:00:00Z" }
  const priya: Engineer = {
    id: 3,
    orgId: 1,
    teamId: 7,
    handle: "p.nair",
    displayName: "Priya Nair",
    seatGrantedAt: "2026-01-01T00:00:00Z",
    seatActive: true,
  }
  const lookup = new LookupService(fakeTeamRepo([nova]), fakeEngineerRepo({ 7: [priya] }), fakeRunRepo([]))

  expect(lookup.getFilterOptions(1).engineers).toEqual([])
  expect(lookup.getFilterOptions(1, 7).engineers).toEqual([{ id: 3, name: "Priya Nair" }])
})

test("listTeams returns every team in the org as plain id/name pairs", () => {
  const teams: Team[] = [
    { id: 1, orgId: 1, name: "Comet", createdAt: "2026-01-01T00:00:00Z" },
    { id: 2, orgId: 1, name: "Anchor", createdAt: "2026-01-01T00:00:00Z" },
  ]
  const lookup = new LookupService(fakeTeamRepo(teams), fakeEngineerRepo({}), fakeRunRepo([]))
  expect(lookup.listTeams(1)).toEqual([
    { id: 1, name: "Comet" },
    { id: 2, name: "Anchor" },
  ])
})
