// End to end: real HTTP requests against a real server, backed by a real seeded temporary
// SQLite database -- docs/testing.md's "Controllers get a real HTTP request." Covers section 3
// (the lookup calls) and section 4 (the org/team metrics calls) of docs/api.md.

import { describe, expect, test } from "bun:test"
import { everyCentsFieldIsAnInteger, getJson, testServer } from "./helpers.ts"

describe("GET /api/filter-options", () => {
  test("200: every team, every agent kind, no engineers when no team is given", async () => {
    const { data } = await testServer()
    const { status, body } = await getJson("/api/filter-options")
    expect(status).toBe(200)
    const b = body as { teams: { id: string; name: string }[]; agentKinds: string[]; engineers: unknown[] }
    expect(b.teams.length).toBe(data.teams.length)
    expect(b.agentKinds.length).toBeGreaterThan(0)
    expect(b.engineers).toEqual([])
  })

  test("200: given a team, engineers is that team's own roster", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const { status, body } = await getJson(`/api/filter-options?team=${anchor.id}`)
    expect(status).toBe(200)
    const b = body as { engineers: { id: string; name: string }[] }
    expect(b.engineers.length).toBe(data.engineers.filter((e) => e.teamId === anchor.id).length)
  })

  test("404: an unknown team id", async () => {
    const { status, body } = await getJson("/api/filter-options?team=999999")
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("not_found")
  })
})

describe("GET /api/teams", () => {
  test("200: every team, id and name only", async () => {
    const { data } = await testServer()
    const { status, body } = await getJson("/api/teams")
    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect((body as unknown[]).length).toBe(data.teams.length)
  })
})

describe("GET /api/metrics/summary", () => {
  test("200: the documented shape, money as whole cents", async () => {
    const { status, body } = await getJson("/api/metrics/summary")
    expect(status).toBe(200)
    const b = body as { from: string; to: string; finishedTasks: number; moneySpentCents: number; defaults: unknown }
    expect(typeof b.from).toBe("string")
    expect(typeof b.finishedTasks).toBe("number")
    expect(everyCentsFieldIsAnInteger(body)).toEqual([])
  })

  test("400: a query parameter that isn't a real date, with a message a person can read", async () => {
    const { status, body } = await getJson("/api/metrics/summary?from=not-a-date")
    expect(status).toBe(400)
    const b = body as { error: { code: string; message: string } }
    expect(b.error.code).toBe("bad_request")
    expect(b.error.message.length).toBeGreaterThan(0)
  })

  test("404: scoped to a team id that doesn't exist", async () => {
    const { status, body } = await getJson("/api/metrics/summary?team=999999")
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("not_found")
  })
})

describe("GET /api/metrics/adoption", () => {
  test("200: both rolling windows, depth of use, sticking rate", async () => {
    const { status, body } = await getJson("/api/metrics/adoption")
    expect(status).toBe(200)
    const b = body as { adoptionRate: { last7d: unknown; last30d: unknown }; depthOfUse: { totalSeats: number } }
    expect(b.adoptionRate.last7d).toBeDefined()
    expect(b.adoptionRate.last30d).toBeDefined()
    expect(b.depthOfUse.totalSeats).toBeGreaterThan(0)
  })
})

describe("GET /api/metrics/outcomes", () => {
  test("200: success rate windows, outputs by kind, rework rate", async () => {
    const { status, body } = await getJson("/api/metrics/outcomes")
    expect(status).toBe(200)
    const b = body as { outputs: { kind: string; count: number }[]; reworkRate: { rate: number } }
    expect(b.outputs.length).toBeGreaterThan(0)
    expect(typeof b.reworkRate.rate).toBe("number")
  })
})

describe("GET /api/metrics/cost", () => {
  test("200: cost per finished task and tokens used, every money field a whole number of cents", async () => {
    const { status, body } = await getJson("/api/metrics/cost")
    expect(status).toBe(200)
    expect(everyCentsFieldIsAnInteger(body)).toEqual([])
    const b = body as { costPerFinishedTask: { medianCents: number; averageCents: number } }
    expect(b.costPerFinishedTask.medianCents).toBeGreaterThanOrEqual(0)
  })
})

describe("GET /api/metrics/reliability", () => {
  test("200: failure rate windows, quiet failures, retry rate, time before giving up", async () => {
    const { status, body } = await getJson("/api/metrics/reliability")
    expect(status).toBe(200)
    const b = body as { failureRate: { last7d: { byCause: unknown[] } }; timeBeforeGivingUp: { p50Ms: number } }
    expect(b.failureRate.last7d.byCause.length).toBe(12) // every FailureCause, zero-filled
    expect(typeof b.timeBeforeGivingUp.p50Ms).toBe("number")
  })
})

describe("GET /api/metrics/speed", () => {
  test("200: turn time and run time percentiles, timed-out runs kept apart", async () => {
    const { status, body } = await getJson("/api/metrics/speed")
    expect(status).toBe(200)
    const b = body as { turnTime: { p50Ms: number; p95Ms: number; p99Ms: number }; timedOutRuns: number }
    expect(b.turnTime.p99Ms).toBeGreaterThanOrEqual(b.turnTime.p50Ms)
    expect(typeof b.timedOutRuns).toBe("number")
  })
})

describe("GET /api/metrics/flags", () => {
  test("200: flags by severity and status, dismissed-as-expected rate", async () => {
    const { status, body } = await getJson("/api/metrics/flags?from=2026-01-01T00:00:00Z&to=2026-09-01T00:00:00Z")
    expect(status).toBe(200)
    const b = body as { bySeverity: { severity: string; count: number }[]; dismissedExpectedRate: number }
    expect(b.bySeverity.length).toBe(3)
    expect(b.dismissedExpectedRate).toBeGreaterThanOrEqual(0)
    expect(b.dismissedExpectedRate).toBeLessThanOrEqual(1)
  })
})

describe("GET /api/metrics/in-progress", () => {
  test("200: a live count and cost so far, never mixed into a finished-run number", async () => {
    const { status, body } = await getJson("/api/metrics/in-progress")
    expect(status).toBe(200)
    const b = body as { count: number; costSoFarCents: number }
    expect(typeof b.count).toBe("number")
    expect(Number.isInteger(b.costSoFarCents)).toBe(true)
  })
})

describe("GET /api/flags", () => {
  test("200: a page of flags, newest-kind-first, with a team column", async () => {
    const { status, body } = await getJson("/api/flags?from=2026-01-01T00:00:00Z&to=2026-09-01T00:00:00Z&limit=5")
    expect(status).toBe(200)
    const b = body as { items: { id: string; teamId: string; teamName: string }[]; total: number; limit: number }
    expect(b.limit).toBe(5)
    expect(b.items.length).toBeLessThanOrEqual(5)
    if (b.items.length > 0) {
      expect(typeof b.items[0]!.teamId).toBe("string")
      expect(typeof b.items[0]!.teamName).toBe("string")
    }
  })

  test("400: limit above the documented max of 200", async () => {
    const { status, body } = await getJson("/api/flags?limit=500")
    expect(status).toBe(400)
    expect((body as { error: { code: string } }).error.code).toBe("bad_request")
  })
})
