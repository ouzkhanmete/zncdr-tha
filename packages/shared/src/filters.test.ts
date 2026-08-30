import { describe, expect, test } from "bun:test"
import { rangeFilter } from "./filters.ts"

describe("rangeFilter", () => {
  test("rejects a from that comes after to", () => {
    const result = rangeFilter.safeParse({
      from: "2026-08-10T00:00:00Z",
      to: "2026-08-01T00:00:00Z",
    })
    expect(result.success).toBe(false)
  })

  test("fills in the documented defaults: to defaults to now, from to 30 days before to", () => {
    const result = rangeFilter.parse({ to: "2026-08-30T00:00:00Z" })
    expect(result.to).toBe("2026-08-30T00:00:00Z")
    expect(new Date(result.from).getTime()).toBe(new Date("2026-07-31T00:00:00Z").getTime())
  })

  test("passes with no filters at all, still landing on a usable range", () => {
    const result = rangeFilter.parse({})
    expect(new Date(result.from).getTime()).toBeLessThan(new Date(result.to).getTime())
  })
})
