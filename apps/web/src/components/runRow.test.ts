import { describe, expect, test } from "bun:test"
import type { RunSummary } from "@app/shared"
import { buildRunRow } from "./runRow.ts"

const baseRun: RunSummary = {
  id: "8560",
  teamId: "7",
  engineerId: "114",
  agentKind: "dependency-bump",
  trigger: "person",
  repo: "mobile-app",
  branch: "feature/sync-489",
  parentRunId: null,
  startedAt: "2026-08-28T23:06:30Z",
  finishedAt: "2026-08-28T23:07:02Z",
  status: "succeeded",
  failureCause: null,
  blame: null,
  isQuietFailure: false,
  durationMs: 32525,
  totalCostCents: 84,
  turnCount: 3,
  toolCallCount: 8,
  taskSummary: "Bump lodash to patch CVE",
  primaryOutputKind: "pull_request",
}

describe("buildRunRow", () => {
  test("a succeeded run with a resolved engineer and team", () => {
    const row = buildRunRow(baseRun, { engineerName: "Jae Kim", teamName: "Nova" })
    expect(row.outcomeEmoji).toBe("✅")
    expect(row.outcomeLabel).toBe("succeeded")
    expect(row.engineerLabel).toBe("Jae Kim")
    expect(row.teamLabel).toBe("Nova")
    expect(row.outputEmoji).toBe("🔀")
    expect(row.costLabel).toBe("$0.84")
    expect(row.durationLabel).toBe("32.5s")
    expect(row.whenLabel).toBe("Aug 28 · 23:06")
  })

  test("a failed run gets a plain X -- an ordinary failure is not act-now, so no red status", () => {
    const row = buildRunRow({ ...baseRun, status: "failed" })
    expect(row.outcomeEmoji).toBe("❌")
    expect(row.outcomeLabel).toBe("failed")
  })

  test("a run still in progress has no duration to show yet", () => {
    const row = buildRunRow({ ...baseRun, status: "running", finishedAt: null, durationMs: null })
    expect(row.outcomeEmoji).toBeNull()
    expect(row.outcomeLabel).toBe("running")
    expect(row.durationLabel).toBe("still running")
  })

  test("cancelled and timed-out runs show plain words, not the raw status string", () => {
    expect(buildRunRow({ ...baseRun, status: "cancelled" }).outcomeLabel).toBe("cancelled")
    expect(buildRunRow({ ...baseRun, status: "timed_out" }).outcomeLabel).toBe("timed out")
    expect(buildRunRow({ ...baseRun, status: "cancelled" }).outcomeEmoji).toBeNull()
    expect(buildRunRow({ ...baseRun, status: "timed_out" }).outcomeEmoji).toBeNull()
  })

  test("a run with no artifact shows no output icon", () => {
    const row = buildRunRow({ ...baseRun, primaryOutputKind: null })
    expect(row.outputEmoji).toBeNull()
  })

  test("automation started it -- no engineer to name, even if a stale name was passed in", () => {
    const row = buildRunRow({ ...baseRun, engineerId: null, trigger: "automation" }, { engineerName: "should be ignored" })
    expect(row.engineerLabel).toBe("Automation")
  })

  test("a real engineer id whose name hasn't resolved yet falls back to a dash, not a blank", () => {
    const row = buildRunRow(baseRun, {})
    expect(row.engineerLabel).toBe("—")
  })

  test("no team name given -- a caller already scoped to one team leaves teamLabel null", () => {
    const row = buildRunRow(baseRun, { engineerName: "Jae Kim" })
    expect(row.teamLabel).toBeNull()
  })
})
