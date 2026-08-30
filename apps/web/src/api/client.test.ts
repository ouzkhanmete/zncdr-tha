import { describe, expect, test } from "bun:test"
import { buildQuery } from "./client.ts"

describe("buildQuery", () => {
  test("drops undefined values instead of stringifying them", () => {
    expect(buildQuery({ team: undefined, agentKind: "code-fix" })).toBe("?agentKind=code-fix")
  })

  test("returns an empty string with no params at all", () => {
    expect(buildQuery()).toBe("")
    expect(buildQuery({})).toBe("")
  })

  test("returns an empty string when every value is undefined", () => {
    expect(buildQuery({ from: undefined, to: undefined })).toBe("")
  })

  test("stringifies numbers and booleans", () => {
    expect(buildQuery({ limit: 50, offset: 0 })).toBe("?limit=50&offset=0")
  })
})
