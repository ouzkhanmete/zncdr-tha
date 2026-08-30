// docs/api.md section 5 -- budget status (org and team), the raw setting, and the one write.

import { describe, expect, test } from "bun:test"
import { CURRENT_MONTH, NOVA_BUDGET } from "../src/seed/config.ts"
import { everyCentsFieldIsAnInteger, getJson, putJson, testServer } from "./helpers.ts"

describe("GET /api/budget-status", () => {
  test("200: org scope adds every team's budget into one figure", async () => {
    const { status, body } = await getJson("/api/budget-status")
    expect(status).toBe(200)
    const b = body as { scope: string; teamId: string | null; teamsWithoutBudget: number; dailySpend: unknown[] }
    expect(b.scope).toBe("org")
    expect(b.teamId).toBeNull()
    expect(typeof b.teamsWithoutBudget).toBe("number")
    expect(Array.isArray(b.dailySpend)).toBe(true)
    expect(everyCentsFieldIsAnInteger(body)).toEqual([])
  })

  test("200: team scope -- Nova has already crossed its stop line this month (docs/seed-data.md)", async () => {
    const { data } = await testServer()
    const nova = data.teams.find((t) => t.name === "Nova")!
    const { status, body } = await getJson(`/api/budget-status?team=${nova.id}`)
    expect(status).toBe(200)
    const b = body as { scope: string; teamId: string; stopLineCrossed: boolean; limitCents: number }
    expect(b.scope).toBe("team")
    expect(b.teamId).toBe(String(nova.id))
    expect(b.limitCents).toBe(NOVA_BUDGET.limitCents)
    expect(b.stopLineCrossed).toBe(true)
  })

  test("404: an unknown team id", async () => {
    const { status, body } = await getJson("/api/budget-status?team=999999")
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("not_found")
  })
})

describe("GET /api/teams/:teamId/budget", () => {
  test("200: the raw setting for a team and month that has one", async () => {
    const { data } = await testServer()
    const nova = data.teams.find((t) => t.name === "Nova")!
    const { status, body } = await getJson(`/api/teams/${nova.id}/budget?month=${CURRENT_MONTH}`)
    expect(status).toBe(200)
    expect(body).toMatchObject({ teamId: String(nova.id), month: CURRENT_MONTH, limitCents: NOVA_BUDGET.limitCents })
  })

  test("404: a month nobody has set a budget for yet", async () => {
    const { data } = await testServer()
    const nova = data.teams.find((t) => t.name === "Nova")!
    const { status, body } = await getJson(`/api/teams/${nova.id}/budget?month=2019-01`)
    expect(status).toBe(404)
    expect((body as { error: { code: string } }).error.code).toBe("not_found")
  })

  test("404: an unknown team id", async () => {
    const { status } = await getJson("/api/teams/999999/budget")
    expect(status).toBe(404)
  })
})

describe("PUT /api/teams/:teamId/budget", () => {
  test("200: writes a new budget, and reading it back returns exactly what was written", async () => {
    const { data } = await testServer()
    const comet = data.teams.find((t) => t.name === "Comet")!
    const month = "2030-01" // far outside the seeded data, so this write can't collide with it

    const put = await putJson(`/api/teams/${comet.id}/budget`, {
      month,
      limitCents: 500_00,
      warnCents: 400_00,
      stopCents: 500_00,
    })
    expect(put.status).toBe(200)
    expect(put.body).toEqual({ teamId: String(comet.id), month, limitCents: 500_00, warnCents: 400_00, stopCents: 500_00 })

    const get = await getJson(`/api/teams/${comet.id}/budget?month=${month}`)
    expect(get.status).toBe(200)
    expect(get.body).toEqual(put.body)
  })

  test("200: stopCents equal to limitCents is the normal case, not an error", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const put = await putJson(`/api/teams/${anchor.id}/budget`, {
      month: "2030-02",
      limitCents: 100_00,
      warnCents: 80_00,
      stopCents: 100_00,
    })
    expect(put.status).toBe(200)
  })

  test("422 invalid_budget: the warning line is not below the stop line", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const { status, body } = await putJson(`/api/teams/${anchor.id}/budget`, {
      month: "2030-03",
      limitCents: 100_00,
      warnCents: 80_00,
      stopCents: 80_00, // equal, not strictly below
    })
    expect(status).toBe(422)
    expect((body as { error: { code: string } }).error.code).toBe("invalid_budget")
  })

  test("422 invalid_budget: the stop line is above the limit", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const { status, body } = await putJson(`/api/teams/${anchor.id}/budget`, {
      month: "2030-04",
      limitCents: 50_00,
      warnCents: 10_00,
      stopCents: 60_00,
    })
    expect(status).toBe(422)
    expect((body as { error: { code: string } }).error.code).toBe("invalid_budget")
  })

  test("400 bad_request: a malformed body never reaches the budget rules at all", async () => {
    const { data } = await testServer()
    const anchor = data.teams.find((t) => t.name === "Anchor")!
    const { status, body } = await putJson(`/api/teams/${anchor.id}/budget`, {
      month: "not-a-month",
      limitCents: 100_00,
      warnCents: 80_00,
      stopCents: 100_00,
    })
    expect(status).toBe(400)
    expect((body as { error: { code: string } }).error.code).toBe("bad_request")
  })

  test("404: an unknown team id", async () => {
    const { status } = await putJson("/api/teams/999999/budget", {
      month: "2030-05",
      limitCents: 100_00,
      warnCents: 80_00,
      stopCents: 100_00,
    })
    expect(status).toBe(404)
  })
})
