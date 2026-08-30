import { describe, expect, test } from "bun:test"
import { ApiError } from "../api/client.ts"
import { errorMessage } from "./useSection.ts"

describe("errorMessage", () => {
  test("uses an ApiError's own message -- already a plain sentence, per docs/api.md section 8", () => {
    expect(errorMessage(new ApiError("No team matches that id.", 404, "not_found"))).toBe("No team matches that id.")
  })

  test("uses a plain Error's message", () => {
    expect(errorMessage(new Error("network down"))).toBe("network down")
  })

  test("falls back to a generic sentence for anything else, rather than leaking a raw value", () => {
    expect(errorMessage("boom")).toBe("Something went wrong.")
    expect(errorMessage(undefined)).toBe("Something went wrong.")
  })
})
