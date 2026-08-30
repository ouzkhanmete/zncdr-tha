import { describe, expect, test } from "bun:test"
import { run } from "./entities.ts"

describe("run entity", () => {
  const base = {
    id: 1,
    orgId: 1,
    teamId: 1,
    engineerId: 1,
    parentRunId: null,
    agentKind: "code-fix",
    trigger: "person" as const,
    repo: "acme/app",
    branch: "main",
    startedAt: "2026-08-01T00:00:00Z",
    actorUtcOffsetMinutes: 0,
    finishedAt: "2026-08-01T00:05:00Z",
    isQuietFailure: false,
    durationMs: 300_000,
    totalCostCents: 500,
    turnCount: 3,
    toolCallCount: 1,
    taskSummary: "Fix flaky checkout test",
  }

  test("rejects a failed run with no failureCause or blame", () => {
    const result = run.safeParse({ ...base, status: "failed", failureCause: null, blame: null })
    expect(result.success).toBe(false)
  })

  test("accepts a failed run that carries both a failureCause and a blame", () => {
    const result = run.safeParse({
      ...base,
      status: "failed",
      failureCause: "tests_failed",
      blame: "task",
    })
    expect(result.success).toBe(true)
  })
})
