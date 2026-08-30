import { describe, expect, test } from "bun:test"
import { expectedRange, isOutsideRange } from "./comparisonBand.ts"

describe("expectedRange", () => {
  test("narrows as run count grows -- a bigger sample gets a tighter expected range", () => {
    const small = expectedRange(0.85, 60)
    const large = expectedRange(0.85, 900)

    expect(large.high - large.low).toBeLessThan(small.high - small.low)
  })

  test("stays centered on the org rate", () => {
    const range = expectedRange(0.85, 400)
    const midpoint = (range.low + range.high) / 2
    expect(midpoint).toBeCloseTo(0.85, 5)
  })

  test("clamps to [0, 1] for a tiny run count that would otherwise overshoot", () => {
    const range = expectedRange(0.5, 2)
    expect(range.low).toBeGreaterThanOrEqual(0)
    expect(range.high).toBeLessThanOrEqual(1)
  })
})

describe("isOutsideRange", () => {
  test("a low-volume team's low rate can still be inside its (wide) band", () => {
    const range = expectedRange(0.85, 20)
    expect(isOutsideRange(0.72, range)).toBe(false)
  })

  test("the same low rate from a high-volume team falls outside its (narrow) band", () => {
    const range = expectedRange(0.85, 950)
    expect(isOutsideRange(0.72, range)).toBe(true)
  })
})
