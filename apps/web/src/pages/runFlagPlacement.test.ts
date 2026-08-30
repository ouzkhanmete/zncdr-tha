import { describe, expect, test } from "bun:test"
import type { RunPolicyFlag } from "@app/shared"
import { groupFlagsByTurn, worstSeverity } from "./runFlagPlacement.ts"

function flag(overrides: Partial<RunPolicyFlag> = {}): RunPolicyFlag {
  return {
    id: "1",
    turnId: null,
    kind: "unsafe_command",
    severity: "high",
    status: "confirmed",
    detail: "rm -rf /",
    createdAt: "2026-08-01T09:00:00Z",
    ...overrides,
  }
}

describe("groupFlagsByTurn", () => {
  test("a flag with a turn id lands on that turn", () => {
    const goalHijack = flag({ id: "1", turnId: "3", kind: "goal_hijacked" })
    const byTurn = groupFlagsByTurn([goalHijack])
    expect(byTurn.get("3")).toEqual([goalHijack])
  })

  test("a flag without a turn id stays run-level only -- it is absent from the map entirely", () => {
    const runLevel = flag({ id: "2", turnId: null, kind: "spend_cap_crossed" })
    const byTurn = groupFlagsByTurn([runLevel])
    expect(byTurn.size).toBe(0)
  })

  test("a turn with several flags shows all of them, in the order they were given", () => {
    const first = flag({ id: "1", turnId: "2", kind: "unsafe_command" })
    const second = flag({ id: "2", turnId: "2", kind: "secret_exposed" })
    const byTurn = groupFlagsByTurn([first, second])
    expect(byTurn.get("2")).toEqual([first, second])
  })

  test("flags on different turns, and one with no turn, all land in the right place at once", () => {
    const onTurnOne = flag({ id: "1", turnId: "1", kind: "unsafe_command" })
    const onTurnTwo = flag({ id: "2", turnId: "2", kind: "blocked_domain_attempt" })
    const runLevel = flag({ id: "3", turnId: null, kind: "spend_cap_crossed" })
    const byTurn = groupFlagsByTurn([onTurnOne, onTurnTwo, runLevel])

    expect(byTurn.get("1")).toEqual([onTurnOne])
    expect(byTurn.get("2")).toEqual([onTurnTwo])
    expect(byTurn.size).toBe(2)
  })
})

describe("worstSeverity", () => {
  test("no flags -- nothing to colour a row with", () => {
    expect(worstSeverity([])).toBeNull()
  })

  test("one flag -- its own severity", () => {
    expect(worstSeverity([flag({ severity: "low" })])).toBe("low")
  })

  test("a mix of severities -- the highest one wins, never averaged down", () => {
    const flags = [flag({ severity: "low" }), flag({ severity: "high" }), flag({ severity: "medium" })]
    expect(worstSeverity(flags)).toBe("high")
  })

  test("several low and medium flags, no high one -- medium wins", () => {
    const flags = [flag({ severity: "low" }), flag({ severity: "medium" }), flag({ severity: "low" })]
    expect(worstSeverity(flags)).toBe("medium")
  })
})
