// docs/api.md section 6 (the engineer screen) and section 7 (run search and detail).

import { describe, expect, test } from "bun:test"
import { everyCentsFieldIsAnInteger, getJson, testServer } from "./helpers.ts"

describe("GET /api/engineers/:engineerId/overview", () => {
  test("200: their own numbers, nobody else's, money as whole cents", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const engineer = data.engineers.find((e) => e.teamId === anchor.id && !e.dormant)!
    const { status, body } = await getJson(`/api/engineers/${engineer.id}/overview`)
    expect(status).toBe(200)
    const b = body as { engineerId: string; depthOfUse: string }
    expect(b.engineerId).toBe(String(engineer.id))
    expect(["deep", "regular", "light", "dormant"]).toContain(b.depthOfUse)
    expect(everyCentsFieldIsAnInteger(body)).toEqual([])
  })

  test("404: an unknown engineer id", async () => {
    const { status, body } = await getJson("/api/engineers/999999/overview")
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("not_found")
  })
})

describe("GET /api/engineers/:engineerId/trend", () => {
  test("200: their own trend line, defaulting to a trailing 90 days", async () => {
    const { data } = await testServer()
    const engineer = data.engineers.find((e) => !e.dormant)!
    const { status, body } = await getJson(`/api/engineers/${engineer.id}/trend`)
    expect(status).toBe(200)
    const b = body as { interval: string; points: unknown[] }
    expect(b.interval).toBe("week")
    expect(b.points.length).toBeGreaterThan(0)
  })

  test("404: an unknown engineer id", async () => {
    const { status } = await getJson("/api/engineers/999999/trend")
    expect(status).toBe(404)
  })
})

describe("GET /api/engineers/:engineerId/runs", () => {
  test("200: a page of this engineer's own runs, teamId and engineerId left off each row", async () => {
    const { data } = await testServer()
    const engineer = data.engineers.find((e) => !e.dormant)!
    const { status, body } = await getJson(`/api/engineers/${engineer.id}/runs?from=2026-01-01T00:00:00Z&to=2026-09-01T00:00:00Z&limit=5`)
    expect(status).toBe(200)
    const b = body as { items: Record<string, unknown>[]; limit: number }
    expect(b.limit).toBe(5)
    for (const item of b.items) {
      expect(item).not.toHaveProperty("teamId")
      expect(item).not.toHaveProperty("engineerId")
    }
  })
})

describe("GET /api/runs", () => {
  test("200: a page of runs, one row shaped like docs/api.md's RunSummary", async () => {
    const { status, body } = await getJson("/api/runs?from=2026-01-01T00:00:00Z&to=2026-09-01T00:00:00Z&limit=10")
    expect(status).toBe(200)
    const b = body as { items: Record<string, unknown>[]; total: number; limit: number; offset: number }
    expect(b.limit).toBe(10)
    expect(b.total).toBeGreaterThan(0)
    const row = b.items[0]!
    for (const field of ["id", "teamId", "agentKind", "status", "totalCostCents", "taskSummary"]) {
      expect(row).toHaveProperty(field)
    }
    expect(everyCentsFieldIsAnInteger(body)).toEqual([])
  })

  test("400: an unknown status value", async () => {
    const { status, body } = await getJson("/api/runs?status=not-a-status")
    expect(status).toBe(400)
    expect((body as { error: { code: string } }).error.code).toBe("bad_request")
  })

  test("404: filtering by an engineer id that doesn't exist", async () => {
    const { status } = await getJson("/api/runs?engineer=999999")
    expect(status).toBe(404)
  })
})

describe("GET /api/runs/:runId", () => {
  test("200: the full timeline of one run", async () => {
    const search = await getJson("/api/runs?from=2026-01-01T00:00:00Z&to=2026-09-01T00:00:00Z&limit=1")
    const runId = (search.body as { items: { id: string }[] }).items[0]!.id

    const { status, body } = await getJson(`/api/runs/${runId}`)
    expect(status).toBe(200)
    const b = body as { id: string; taskAttempts: unknown[]; turns: unknown[]; toolCalls: unknown[]; artifacts: unknown[]; policyFlags: unknown[] }
    expect(b.id).toBe(runId)
    expect(Array.isArray(b.taskAttempts)).toBe(true)
    expect(b.taskAttempts.length).toBeGreaterThan(0)
    expect(Array.isArray(b.turns)).toBe(true)
    expect(everyCentsFieldIsAnInteger(body)).toEqual([])
  })

  test("404: a run id that doesn't exist", async () => {
    const { status, body } = await getJson("/api/runs/999999")
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("not_found")
  })
})
