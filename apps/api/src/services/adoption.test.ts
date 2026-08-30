import { expect, test } from "bun:test"
import type { Engineer, Run } from "@app/shared"
import type { EngineerRepository } from "../repositories/engineers.ts"
import type { OrgRepository } from "../repositories/orgs.ts"
import type { RunRepository } from "../repositories/runs.ts"
import { AdoptionService } from "./adoption.ts"

// Fixed anchor for every test -- "now" is always supplied by the caller (see adoption.ts's
// AdoptionQuery), never read off the system clock, so these tests never depend on the day
// they happen to run. Windows work out to: last 7d = [2026-08-22, 2026-08-29),
// last 30d = [2026-07-30, 2026-08-29).
const NOW = "2026-08-29T00:00:00Z"

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used in this test`)
  }
}

function fakeOrgRepo(licensedSeats: number | undefined): OrgRepository {
  return {
    create: notImplemented("create"),
    list: notImplemented("list"),
    findById: (id) =>
      licensedSeats === undefined ? undefined : { id, name: "Acme", licensedSeats, createdAt: "2026-01-01T00:00:00Z" },
  }
}

function fakeEngineerRepo(engineers: Engineer[]): EngineerRepository {
  return {
    create: notImplemented("create"),
    findById: notImplemented("findById"),
    findByHandle: notImplemented("findByHandle"),
    listByTeamId: notImplemented("listByTeamId"),
    updateTeam: notImplemented("updateTeam"),
    listByOrgId: () => engineers,
  }
}

/** A fake that behaves like the real repository for the two things adoption.ts actually asks of
 *  it: every run whose own `startedAt` falls in a window (`listStartedIn`), and the distinct
 *  engineer ids behind every run ever started (`everStartedEngineerIds`). `search` is left
 *  `notImplemented` on purpose -- proves adoption no longer routes through the paged search path.
 *  Team/agentKind scoping is ignored -- no test below exercises it. */
function fakeRunRepo(allRuns: Run[]): RunRepository {
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
    search: notImplemented("search"),
    listStartedIn: (_orgId, window) => allRuns.filter((r) => r.startedAt >= window.from && r.startedAt < window.to),
    everStartedEngineerIds: () =>
      [...new Set(allRuns.filter(isPersonRun).map((r) => r.engineerId))],
  }
}

function isPersonRun(run: Run): run is Run & { engineerId: number } {
  return run.engineerId !== null
}

function engineer(overrides: Partial<Engineer> & { id: number }): Engineer {
  return {
    orgId: 1,
    teamId: null,
    handle: `eng-${overrides.id}`,
    displayName: `Engineer ${overrides.id}`,
    seatGrantedAt: "2026-01-01T00:00:00Z",
    seatActive: true,
    ...overrides,
  }
}

let nextRunId = 1
function run(overrides: Partial<Run> & { engineerId: number | null; startedAt: string }): Run {
  return {
    id: nextRunId++,
    orgId: 1,
    teamId: 1,
    parentRunId: null,
    agentKind: "coder",
    trigger: overrides.engineerId === null ? "automation" : "person",
    repo: null,
    branch: null,
    actorUtcOffsetMinutes: 0,
    finishedAt: null,
    status: "succeeded",
    failureCause: null,
    blame: null,
    isQuietFailure: false,
    durationMs: null,
    totalCostCents: 0,
    turnCount: 0,
    toolCallCount: 0,
    taskSummary: "",
    ...overrides,
  }
}

/** `count` non-overlapping five-minute runs for one engineer, one per day starting August 1st --
 *  every one comfortably inside the last-30-days window ending at `NOW`. */
function sequentialRuns(engineerId: number, count: number): Run[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, "0")
    return run({ engineerId, startedAt: `2026-08-${day}T09:00:00Z`, finishedAt: `2026-08-${day}T09:05:00Z` })
  })
}

test("adoption rate divides by licensed seats, not by the people who tried it", () => {
  // 10 licensed seats. 4 engineers have ever run anything; 3 of those ran in the last 7 days.
  const engineers = [1, 2, 3, 4].map((id) => engineer({ id }))
  const runs = [
    run({ engineerId: 1, startedAt: "2026-08-25T09:00:00Z" }), // last 7d
    run({ engineerId: 2, startedAt: "2026-08-24T09:00:00Z" }), // last 7d
    run({ engineerId: 3, startedAt: "2026-08-23T09:00:00Z" }), // last 7d
    run({ engineerId: 4, startedAt: "2026-08-05T09:00:00Z" }), // last 30d only
  ]
  const service = new AdoptionService(fakeOrgRepo(10), fakeEngineerRepo(engineers), fakeRunRepo(runs))

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  // Would come out to 3/4 if this divided by people who ever tried it instead of seats.
  expect(result.adoptionRate.last7d).toEqual({ activeEngineers: 3, licensedSeats: 10, rate: 0.3 })
  expect(result.adoptionRate.last30d).toEqual({ activeEngineers: 4, licensedSeats: 10, rate: 0.4 })
})

test("sticking rate uses a different bottom than adoption rate, from the exact same rows", () => {
  // Same fixture as the adoption-rate test above.
  const engineers = [1, 2, 3, 4].map((id) => engineer({ id }))
  const runs = [
    run({ engineerId: 1, startedAt: "2026-08-25T09:00:00Z" }),
    run({ engineerId: 2, startedAt: "2026-08-24T09:00:00Z" }),
    run({ engineerId: 3, startedAt: "2026-08-23T09:00:00Z" }),
    run({ engineerId: 4, startedAt: "2026-08-05T09:00:00Z" }),
  ]
  const service = new AdoptionService(fakeOrgRepo(10), fakeEngineerRepo(engineers), fakeRunRepo(runs))

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  // 3/4, not 3/10 -- mixing this up with adoption rate would silently swap the question being
  // answered even though both numbers share the same numerator.
  expect(result.stickingRate).toEqual({ activeInLast7d: 3, everRun: 4, rate: 0.75 })
})

test("adoption counts distinct engineers via listStartedIn/everStartedEngineerIds, never through the paged search path", () => {
  // Engineer 1 runs twice in the same window -- must still count as one active engineer.
  const engineers = [1, 2].map((id) => engineer({ id }))
  const runs = [
    run({ engineerId: 1, startedAt: "2026-08-25T09:00:00Z" }),
    run({ engineerId: 1, startedAt: "2026-08-26T09:00:00Z" }),
    run({ engineerId: 2, startedAt: "2026-08-05T09:00:00Z" }), // outside 7d, inside 30d
  ]
  const service = new AdoptionService(fakeOrgRepo(10), fakeEngineerRepo(engineers), fakeRunRepo(runs))

  // fakeRunRepo's `search` throws if called -- this only passes because adoption.ts goes through
  // `listStartedIn` and `everStartedEngineerIds` instead.
  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  expect(result.adoptionRate.last7d.activeEngineers).toBe(1) // engineer 1, once, not twice
  expect(result.adoptionRate.last30d.activeEngineers).toBe(2)
  expect(result.stickingRate.everRun).toBe(2)
})

test("depth of use lands every seat in exactly one bucket, boundaries included", () => {
  const dormant = engineer({ id: 1 })
  const light1 = engineer({ id: 2 })
  const light4 = engineer({ id: 3 })
  const regular5 = engineer({ id: 4 })
  const regular19 = engineer({ id: 5 })
  const deep20 = engineer({ id: 6 })
  const deepOverlap = engineer({ id: 7 })
  const engineers = [dormant, light1, light4, regular5, regular19, deep20, deepOverlap]

  const runs = [
    ...sequentialRuns(light1.id, 1),
    ...sequentialRuns(light4.id, 4),
    ...sequentialRuns(regular5.id, 5),
    ...sequentialRuns(regular19.id, 19),
    ...sequentialRuns(deep20.id, 20),
    // Only 2 runs total, but they overlap -- must land in "deep" anyway.
    run({ engineerId: deepOverlap.id, startedAt: "2026-08-15T09:00:00Z", finishedAt: "2026-08-15T09:30:00Z" }),
    run({ engineerId: deepOverlap.id, startedAt: "2026-08-15T09:10:00Z", finishedAt: "2026-08-15T09:20:00Z" }),
  ]
  const service = new AdoptionService(fakeOrgRepo(100), fakeEngineerRepo(engineers), fakeRunRepo(runs))

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  expect(result.depthOfUse).toEqual({ deep: 2, regular: 2, light: 2, dormant: 1, totalSeats: 7 })
})

test("a seat that's no longer active is left out of depth of use entirely", () => {
  const stillActive = engineer({ id: 1, seatActive: true })
  const revoked = engineer({ id: 2, seatActive: false })
  // The revoked seat ran plenty before losing its seat -- still must not appear in any bucket.
  const runs = sequentialRuns(revoked.id, 20)
  const service = new AdoptionService(
    fakeOrgRepo(10),
    fakeEngineerRepo([stillActive, revoked]),
    fakeRunRepo(runs),
  )

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  expect(result.depthOfUse).toEqual({ deep: 0, regular: 0, light: 0, dormant: 1, totalSeats: 1 })
})

test("a run with nobody behind it does not count as adoption", () => {
  const onlySeat = engineer({ id: 1 })
  const runs = [run({ engineerId: null, startedAt: "2026-08-25T09:00:00Z" })]
  const service = new AdoptionService(fakeOrgRepo(5), fakeEngineerRepo([onlySeat]), fakeRunRepo(runs))

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  expect(result.adoptionRate.last30d.activeEngineers).toBe(0)
  expect(result.stickingRate.everRun).toBe(0)
  expect(result.depthOfUse).toEqual({ deep: 0, regular: 0, light: 0, dormant: 1, totalSeats: 1 })
})

test("zero licensed seats gives a zero adoption rate, not a division-by-zero crash", () => {
  const service = new AdoptionService(fakeOrgRepo(0), fakeEngineerRepo([]), fakeRunRepo([]))

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  expect(result.adoptionRate.last7d.rate).toBe(0)
  expect(Number.isNaN(result.adoptionRate.last7d.rate)).toBe(false)
})

test("sticking rate is zero, not NaN, when nobody has ever run anything", () => {
  const service = new AdoptionService(fakeOrgRepo(10), fakeEngineerRepo([]), fakeRunRepo([]))

  const result = service.getAdoptionMetrics({ orgId: 1, now: NOW })

  expect(result.stickingRate).toEqual({ activeInLast7d: 0, everRun: 0, rate: 0 })
})

test("an org that doesn't exist is refused, not silently reported as zero seats", () => {
  const service = new AdoptionService(fakeOrgRepo(undefined), fakeEngineerRepo([]), fakeRunRepo([]))

  expect(() => service.getAdoptionMetrics({ orgId: 999, now: NOW })).toThrow()
})
