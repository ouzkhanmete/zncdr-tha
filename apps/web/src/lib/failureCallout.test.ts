import { describe, expect, test } from "bun:test"
import { dominantCause } from "./failureCallout.ts"

describe("dominantCause", () => {
  test("names the cause when it drives most of the group", () => {
    const result = dominantCause([
      { cause: "missing_secret_or_login", count: 18 },
      { cause: "missing_permission", count: 7 },
      { cause: "tool_not_available", count: 4 },
    ])

    expect(result).not.toBeNull()
    expect(result?.cause).toBe("missing_secret_or_login")
    expect(result?.share).toBeCloseTo(18 / 29, 5)
  })

  test("returns null when the group is split evenly, so nothing is unfairly singled out", () => {
    const result = dominantCause([
      { cause: "tests_failed", count: 10 },
      { cause: "nothing_useful_produced", count: 9 },
      { cause: "dependency_install_failed", count: 8 },
    ])

    expect(result).toBeNull()
  })

  test("returns null for an empty group", () => {
    expect(dominantCause([])).toBeNull()
  })
})
