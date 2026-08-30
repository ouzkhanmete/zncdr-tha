import { describe, expect, test } from "bun:test"
import { dayOfMonth, daysInMonth, daysUntilStopLine, projectedLandingCents } from "./budget.ts"

describe("projectedLandingCents", () => {
  test("gives a different answer for the same percent spent on day 10 vs. day 28 of 30", () => {
    // Both teams have spent the same 90000 cents so far -- a bare percent-used bar would show
    // the two identically. Pace tells them apart.
    const spentSoFarCents = 90_000
    const day10Progress = 10 / 30
    const day28Progress = 28 / 30

    const landingDay10 = projectedLandingCents(spentSoFarCents, day10Progress)
    const landingDay28 = projectedLandingCents(spentSoFarCents, day28Progress)

    expect(landingDay10).not.toBe(landingDay28)
    // Same spend, less of the month gone -> the pace projects much further past it.
    expect(landingDay10).toBeGreaterThan(landingDay28)
    expect(landingDay10).toBe(Math.round(90_000 / (10 / 30)))
    expect(landingDay28).toBe(Math.round(90_000 / (28 / 30)))
  })

  test("matches the Nova example from the wireframes", () => {
    // Nova: $2,070 spent, day 18 of 30.
    const landing = projectedLandingCents(207_000, 18 / 30)
    expect(landing).toBe(345_000) // $3,450, as shown on the team wireframe
  })

  test("falls back to spend-so-far when no time has passed yet, instead of dividing by zero", () => {
    expect(projectedLandingCents(500, 0)).toBe(500)
  })
})

describe("daysUntilStopLine", () => {
  test("says zero when the stop line is already crossed", () => {
    expect(daysUntilStopLine(200_000, 18 / 30, 30, 180_000)).toBe(0)
  })

  test("counts down the days at the current pace when heading toward the line", () => {
    // $100 spent on day 10 of a 30-day month, $10/day pace, stop line at $250 ->
    // 150 more dollars to go at $10/day = 15 more days.
    const days = daysUntilStopLine(10_000, 10 / 30, 30, 25_000)
    expect(days).toBe(15)
  })

  test("returns null when nothing has been spent yet, so there's no pace to extrapolate", () => {
    expect(daysUntilStopLine(0, 10 / 30, 30, 25_000)).toBeNull()
  })

  test("returns null before day one has elapsed", () => {
    expect(daysUntilStopLine(500, 0, 30, 25_000)).toBeNull()
  })
})

describe("daysInMonth", () => {
  test("counts a 31-day month", () => {
    expect(daysInMonth("2026-08")).toBe(31)
  })

  test("counts a 30-day month", () => {
    expect(daysInMonth("2026-09")).toBe(30)
  })

  test("counts February in a leap year", () => {
    expect(daysInMonth("2028-02")).toBe(29)
  })

  test("counts February outside a leap year", () => {
    expect(daysInMonth("2026-02")).toBe(28)
  })
})

describe("dayOfMonth", () => {
  test("reads the day out of a YYYY-MM-DD date", () => {
    expect(dayOfMonth("2026-08-18")).toBe(18)
    expect(dayOfMonth("2026-08-01")).toBe(1)
  })
})
