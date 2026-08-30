// Covers shapes.ts's pure field mapping from a service's numeric-id domain objects to the
// string-id wire shapes docs/api.md documents. `runPolicyFlagWire` (private to this file) is
// exercised through the exported `runDetailWire`, which is what a controller actually calls --
// see docs/api.md's note on RunPolicyFlag.turnId for why this field matters: it's the one thing
// that lets the run page place a flag on the turn that tripped it instead of only the run-level
// card.

import { describe, expect, test } from "bun:test"
import type { RunDetailData, RunWithPrimaryOutput, TurnWithModel } from "../services/run-query.ts"
import { runDetailWire } from "./shapes.ts"

const run: RunWithPrimaryOutput = {
  id: 6814,
  orgId: 1,
  teamId: 7,
  engineerId: 114,
  parentRunId: null,
  agentKind: "code-fix",
  trigger: "person",
  repo: "mobile-app",
  branch: "main",
  startedAt: "2026-08-01T09:00:00Z",
  actorUtcOffsetMinutes: 0,
  finishedAt: "2026-08-01T09:10:00Z",
  status: "failed",
  failureCause: "nothing_useful_produced",
  blame: "task",
  isQuietFailure: false,
  durationMs: 600_000,
  totalCostCents: 500,
  turnCount: 2,
  toolCallCount: 0,
  taskSummary: "Refactor payment retry logic",
  primaryOutputKind: null,
}

const turnA: TurnWithModel = {
  id: 1,
  runId: run.id,
  turnIndex: 0,
  modelId: 1,
  modelName: "claude-fable-5",
  tokensInFresh: 100,
  tokensInCached: 0,
  tokensCacheWrite: 0,
  tokensOut: 50,
  tokensThinking: 0,
  latencyMs: 1_000,
  finishReason: "stop",
  costCents: 10,
  startedAt: "2026-08-01T09:00:00Z",
}

const turnB: TurnWithModel = { ...turnA, id: 2, turnIndex: 1, startedAt: "2026-08-01T09:02:00Z" }

const baseDetail: RunDetailData = {
  run,
  taskAttempts: [
    { runId: run.id, attemptNumber: 1, status: "failed", startedAt: run.startedAt, totalCostCents: 500, isSelf: true, failureCause: "nothing_useful_produced", blame: "task" },
  ],
  turns: [turnA, turnB],
  toolCalls: [],
  artifacts: [],
  policyFlags: [],
}

describe("runDetailWire", () => {
  test("a flag tied to a turn carries that turn's id, as a string, on the wire", () => {
    const wire = runDetailWire({
      ...baseDetail,
      policyFlags: [
        { id: 501, runId: run.id, turnId: turnA.id, kind: "goal_hijacked", severity: "high", disposition: "confirmed", resource: "ignore prior instructions", createdAt: "2026-08-01T09:01:00Z" },
      ],
    })

    expect(wire.policyFlags).toEqual([
      { id: "501", turnId: "1", kind: "goal_hijacked", severity: "high", status: "confirmed", detail: "ignore prior instructions", createdAt: "2026-08-01T09:01:00Z" },
    ])
  })

  test("a run-level flag with no turn carries turnId: null, not a stringified 'null' or a dropped field", () => {
    const wire = runDetailWire({
      ...baseDetail,
      policyFlags: [
        { id: 502, runId: run.id, turnId: null, kind: "spend_cap_crossed", severity: "medium", disposition: "under_review", resource: "monthly-budget", createdAt: "2026-08-01T09:05:00Z" },
      ],
    })

    expect(wire.policyFlags[0]!.turnId).toBeNull()
  })

  test("several flags on the same run keep their own turnId apart from one another", () => {
    const wire = runDetailWire({
      ...baseDetail,
      policyFlags: [
        { id: 503, runId: run.id, turnId: turnA.id, kind: "unsafe_command", severity: "high", disposition: "confirmed", resource: "rm -rf /", createdAt: "2026-08-01T09:00:30Z" },
        { id: 504, runId: run.id, turnId: turnB.id, kind: "blocked_domain_attempt", severity: "low", disposition: "expected_and_dismissed", resource: "internal.corp", createdAt: "2026-08-01T09:02:30Z" },
        { id: 505, runId: run.id, turnId: null, kind: "spend_cap_crossed", severity: "medium", disposition: "under_review", resource: null, createdAt: "2026-08-01T09:06:00Z" },
      ],
    })

    expect(wire.policyFlags.map((f) => f.turnId)).toEqual(["1", "2", null])
  })
})
