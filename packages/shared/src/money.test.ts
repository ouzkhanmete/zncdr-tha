import { describe, expect, test } from "bun:test"
import { sumCents } from "./money.ts"

describe("sumCents", () => {
  test("adds a long list of cents to the same total, whatever order they're added in", () => {
    const amounts = Array.from({ length: 300 }, (_, i) => [33, 34, 33][i % 3] as number)
    const expected = amounts.reduce((a, b) => a + b, 0)

    expect(sumCents(amounts)).toBe(expected)
    expect(sumCents([...amounts].reverse())).toBe(expected)
    expect(sumCents([...amounts].sort(() => Math.random() - 0.5))).toBe(expected)
  })
})
