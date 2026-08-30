// docs/api.md section 4's trend calls and section 5's "teams, compared fairly" calls.

import { describe, expect, test } from "bun:test"
import { getJson, testServer } from "./helpers.ts"

describe("GET /api/teams/:teamId/comparison", () => {
  test("200: this team's rate against the org's, with a band sized to its own run count", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const { status, body } = await getJson(`/api/teams/${anchor.id}/comparison`)
    expect(status).toBe(200)
    const b = body as { team: { rate: number; runCount: number }; org: { rate: number }; band: { low: number; high: number }; note: string }
    expect(b.team.runCount).toBeGreaterThan(0)
    expect(b.band.low).toBeLessThanOrEqual(b.band.high)
    expect(b.note.length).toBeGreaterThan(0)
  })

  test("404: an unknown team id", async () => {
    const { status } = await getJson("/api/teams/999999/comparison")
    expect(status).toBe(404)
  })
})

describe("GET /api/teams/comparison", () => {
  test("200: every team plotted at once, the literal path winning over the :teamId wildcard", async () => {
    const { data } = await testServer()
    const { status, body } = await getJson("/api/teams/comparison")
    expect(status).toBe(200)
    const b = body as { org: { rate: number; runCount: number }; teams: { teamId: string; teamName: string }[] }
    expect(b.teams.length).toBe(data.teams.length)
    expect(b.org.runCount).toBeGreaterThan(0)
  })

  test("400: an unknown metric value", async () => {
    const { status, body } = await getJson("/api/teams/comparison?metric=nonsense")
    expect(status).toBe(400)
    expect((body as { error: { code: string } }).error.code).toBe("bad_request")
  })
})

describe("GET /api/trend", () => {
  test("200: the org-wide weekly line", async () => {
    const { status, body } = await getJson("/api/trend")
    expect(status).toBe(200)
    const b = body as { interval: string; points: { periodStart: string; periodEnd: string }[] }
    expect(b.interval).toBe("week")
    expect(b.points.length).toBeGreaterThan(0)
  })

  test("200: one team's own daily line", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const { status, body } = await getJson(`/api/trend?team=${anchor.id}&interval=day&from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z`)
    expect(status).toBe(200)
    const b = body as { interval: string; points: unknown[] }
    expect(b.interval).toBe("day")
    expect(b.points.length).toBe(7)
  })

  test("400: from after to", async () => {
    const { status } = await getJson("/api/trend?from=2026-08-10T00:00:00Z&to=2026-08-01T00:00:00Z")
    expect(status).toBe(400)
  })
})
