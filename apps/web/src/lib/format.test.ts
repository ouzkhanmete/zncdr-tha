import { describe, expect, test } from "bun:test"
import { formatCount, formatDuration, formatPercent, formatUtcDate, formatUtcDateTime } from "./format.ts"

describe("formatPercent", () => {
  test("turns a fraction into a whole percent by default", () => {
    expect(formatPercent(0.78)).toBe("78%")
    expect(formatPercent(0.891)).toBe("89%")
  })

  test("supports decimals for the tighter numbers like dismissed-expected rate", () => {
    expect(formatPercent(0.064, 1)).toBe("6.4%")
  })
})

describe("formatCount", () => {
  test("groups thousands", () => {
    expect(formatCount(1652)).toBe("1,652")
  })
})

describe("formatDuration", () => {
  test("sub-second durations show milliseconds", () => {
    expect(formatDuration(400)).toBe("400ms")
  })

  test("whole seconds under a minute don't grow a fake decimal", () => {
    expect(formatDuration(8000)).toBe("8s")
  })

  test("fractional seconds under a minute keep one decimal", () => {
    expect(formatDuration(2100)).toBe("2.1s")
    expect(formatDuration(6800)).toBe("6.8s")
  })

  test("minutes and seconds pad seconds to two digits", () => {
    expect(formatDuration(400_000)).toBe("6m 40s") // 6m 40s
    expect(formatDuration(665_000)).toBe("11m 05s") // 11m 05s, not "11m 5s"
  })

  test("hours roll over past 60 minutes", () => {
    expect(formatDuration(3_661_000)).toBe("1h 01m")
  })

  test("rejects a negative duration rather than printing something nonsensical", () => {
    expect(() => formatDuration(-1)).toThrow()
  })
})

describe("UTC date formatting", () => {
  test("reads a timestamp in UTC, not the local time zone", () => {
    // 23:30 UTC on Aug 29 would already be Aug 30 in most timezones east of UTC -- this must
    // still say Aug 29, because docs/ui.md fixes every day boundary to UTC midnight.
    expect(formatUtcDate("2026-08-29T23:30:00Z")).toBe("Aug 29")
  })

  test("full timestamp includes the UTC marker", () => {
    expect(formatUtcDateTime("2026-08-29T14:02:00Z")).toBe("Aug 29, 2026 · 14:02 UTC")
  })
})
