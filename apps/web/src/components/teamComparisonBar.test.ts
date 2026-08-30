import { describe, expect, test } from "bun:test"
import { bandDirection, buildTeamComparisonTooltip } from "./teamComparisonBar.ts"

const inBand = { teamName: "Anchor", rate: 0.8, runCount: 590, band: { low: 0.76, high: 0.83 }, withinBand: true }
const below = { teamName: "Pinnacle", rate: 0.51, runCount: 37, band: { low: 0.67, high: 0.93 }, withinBand: false }
const above = { teamName: "Lighthouse", rate: 0.86, runCount: 182, band: { low: 0.74, high: 0.85 }, withinBand: false }

describe("bandDirection", () => {
  test("below the band's low edge", () => {
    expect(bandDirection(below)).toBe("below")
  })

  test("above the band's high edge", () => {
    expect(bandDirection(above)).toBe("above")
  })

  test("inside the band", () => {
    expect(bandDirection(inBand)).toBe("in")
  })
})

describe("buildTeamComparisonTooltip", () => {
  test("an in-band team has no callout", () => {
    const lines = buildTeamComparisonTooltip(inBand)
    expect(lines?.teamName).toBe("Anchor")
    expect(lines?.summary).toBe("80% success over 590 runs")
    expect(lines?.expected).toBe("expected 76%–83% for a team this size")
    expect(lines?.callout).toBeNull()
  })

  test("a below-band team is called out as below", () => {
    const lines = buildTeamComparisonTooltip(below)
    expect(lines?.summary).toBe("51% success over 37 runs")
    expect(lines?.callout).toBe("below the expected range")
  })

  test("an above-band team is called out as above, not below", () => {
    const lines = buildTeamComparisonTooltip(above)
    expect(lines?.summary).toBe("86% success over 182 runs")
    expect(lines?.callout).toBe("above the expected range")
  })

  test("no row under the cursor renders nothing", () => {
    expect(buildTeamComparisonTooltip(null)).toBeNull()
    expect(buildTeamComparisonTooltip(undefined)).toBeNull()
  })

  test("a malformed row (the old scatter's cross-series bug) renders nothing, not NaN", () => {
    // This is the shape Recharts could hand a tooltip that read `payload[0]` off a ComposedChart
    // mixing series of different lengths: the shaded band's own datum, which has no `rate` or
    // `runCount` at all.
    const bandCurvePoint = { low: 0.74, span: 0.11 } as any
    expect(buildTeamComparisonTooltip(bandCurvePoint)).toBeNull()
  })

  test("a row missing its band renders nothing", () => {
    expect(buildTeamComparisonTooltip({ teamName: "X", rate: 0.8, runCount: 10 })).toBeNull()
  })
})
