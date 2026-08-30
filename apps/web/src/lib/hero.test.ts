import { describe, expect, test } from "bun:test"
import { computeHero } from "./hero.ts"

describe("computeHero", () => {
  test("matches the org page's default numbers", () => {
    const result = computeHero({
      finishedTasks: 1652,
      moneySpentCents: 1_240_000,
      hoursSavedPerTask: 1.0,
      engineerHourlyCostCents: 8500,
    })

    expect(result.valueReturnedCents).toBe(14_042_000) // $140,420, matching the wireframe
    expect(result.netCents).toBe(14_042_000 - 1_240_000)
    // The product brief's own worked example: ~$7.51 a task against $85/hr pays for itself
    // past about 5 minutes saved.
    expect(result.breakEvenMinutes).not.toBeNull()
    expect(result.breakEvenMinutes as number).toBeGreaterThan(5)
    expect(result.breakEvenMinutes as number).toBeLessThan(5.5)
  })

  test("recomputes when the hours-saved dial changes, with nothing else touched", () => {
    const inputs = { finishedTasks: 1652, moneySpentCents: 1_240_000, engineerHourlyCostCents: 8500 }

    const atOneHour = computeHero({ ...inputs, hoursSavedPerTask: 1.0 })
    const atHalfHour = computeHero({ ...inputs, hoursSavedPerTask: 0.5 })
    const atOneAndHalfHours = computeHero({ ...inputs, hoursSavedPerTask: 1.5 })

    expect(atHalfHour.valueReturnedCents).toBe(atOneHour.valueReturnedCents / 2)
    expect(atOneAndHalfHours.valueReturnedCents).toBe(atOneHour.valueReturnedCents * 1.5)

    // Moving the dial never touches money spent or the break-even point -- the break-even falls
    // out of cost-per-task and the hourly rate alone, not the hours-saved guess.
    expect(atHalfHour.moneySpentCents).toBe(atOneHour.moneySpentCents)
    expect(atHalfHour.breakEvenMinutes).toBe(atOneHour.breakEvenMinutes)

    // But the net does move, since value returned moved and spend didn't.
    expect(atHalfHour.netCents).toBeLessThan(atOneHour.netCents)
    expect(atOneAndHalfHours.netCents).toBeGreaterThan(atOneHour.netCents)
  })

  test("recomputes when the hourly-cost dial changes", () => {
    const inputs = { finishedTasks: 1652, moneySpentCents: 1_240_000, hoursSavedPerTask: 1.0 }

    const at85 = computeHero({ ...inputs, engineerHourlyCostCents: 8500 })
    const at170 = computeHero({ ...inputs, engineerHourlyCostCents: 17000 })

    expect(at170.valueReturnedCents).toBe(at85.valueReturnedCents * 2)
    // A pricier engineer hour makes the same money spent look like it saved less time.
    expect(at170.breakEvenMinutes as number).toBeLessThan(at85.breakEvenMinutes as number)
  })

  test("has no break-even when nothing has finished yet", () => {
    const result = computeHero({
      finishedTasks: 0,
      moneySpentCents: 500,
      hoursSavedPerTask: 1.0,
      engineerHourlyCostCents: 8500,
    })

    expect(result.breakEvenMinutes).toBeNull()
    expect(result.valueReturnedCents).toBe(0)
    expect(result.netCents).toBe(-500)
  })

  test("net goes negative without turning into some special sentinel", () => {
    const result = computeHero({
      finishedTasks: 5,
      moneySpentCents: 1_000_000,
      hoursSavedPerTask: 0.1,
      engineerHourlyCostCents: 8500,
    })

    expect(result.netCents).toBeLessThan(0)
  })
})
