import { describe, expect, test } from "bun:test"
import { formatDollarsAndCents, formatDollarsWhole } from "./money.ts"

describe("formatDollarsWhole", () => {
  test("matches the wireframe's hero numbers", () => {
    expect(formatDollarsWhole(1_240_000)).toBe("$12,400") // money spent
    expect(formatDollarsWhole(14_042_000)).toBe("$140,420") // value returned
    expect(formatDollarsWhole(207_000)).toBe("$2,070") // Nova's spend
  })

  test("formats from whole cents without float drift", () => {
    // The classic float trap: a dollar amount stored as a float can land just off a rounding
    // boundary -- 1.005 rounds down to "1.00" in plain JS, not up to "1.01", because 1.005 isn't
    // exactly representable in a double. Money stored as whole cents never has this problem: 101
    // cents is exactly 101, an integer, with nothing to round away.
    expect((1.005).toFixed(2)).toBe("1.00") // the bug this whole scheme exists to dodge
    expect(formatDollarsAndCents(101)).toBe("$1.01") // the cents version never wobbles

    // Summing many small amounts as dollar-floats visibly drifts...
    let dollarFloatTotal = 0
    for (let i = 0; i < 30; i++) dollarFloatTotal += 0.1
    expect(dollarFloatTotal).not.toBe(3) // drifts to 3.0000000000000013

    // ...but the same 30 dimes summed as whole cents, then formatted once at the end, land
    // exactly on $3.00 -- integer addition can't drift the way repeated float addition can.
    let centsTotal = 0
    for (let i = 0; i < 30; i++) centsTotal += 10
    expect(centsTotal).toBe(300)
    expect(formatDollarsWhole(centsTotal)).toBe("$3")
    expect(formatDollarsAndCents(centsTotal)).toBe("$3.00")
  })

  test("throws rather than silently formatting a value that already drifted", () => {
    expect(() => formatDollarsWhole(1240.5)).toThrow()
  })

  test("handles zero and negative amounts", () => {
    expect(formatDollarsWhole(0)).toBe("$0")
    expect(formatDollarsWhole(-500)).toBe("-$5")
  })
})

describe("formatDollarsAndCents", () => {
  test("matches the run page's cost breakdown", () => {
    expect(formatDollarsAndCents(208)).toBe("$2.08")
    expect(formatDollarsAndCents(12)).toBe("$0.12")
  })

  test("supports sub-cent precision for a single line item's rate-derived cost", () => {
    // A per-token-type subtotal (tokens x a per-million-token rate) can genuinely land between
    // whole cents before the run's total is rounded -- e.g. $1.443, as shown on the run
    // wireframe's thinking-tokens line.
    expect(formatDollarsAndCents(144.3, 3)).toBe("$1.443")
  })
})
