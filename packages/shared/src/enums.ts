import { z } from "zod"

/** How a run ended. See docs/metrics.md Group 2 and Group 4. */
export const runStatus = z.enum(["running", "succeeded", "failed", "cancelled", "timed_out"])
export type RunStatus = z.infer<typeof runStatus>

/**
 * Why a run failed. Only ever set alongside `blame`, and only for `failed` or `timed_out` runs
 * -- see docs/data-model.md's CHECK on `runs`. The twelve causes and whose problem each one is
 * live in docs/metrics.md Group 4.
 */
export const failureCause = z.enum([
  "missing_permission",
  "missing_secret_or_login",
  "tool_not_available",
  "network_or_sandbox_blocked",
  "hit_token_or_time_limit",
  "dependency_install_failed",
  "ran_out_of_context",
  "infrastructure_crash",
  "rate_limited",
  "model_refused",
  "tests_failed",
  "nothing_useful_produced",
])
export type FailureCause = z.infer<typeof failureCause>

/** Whose problem a failure is. Set alongside `failureCause`, never on its own. */
export const blame = z.enum(["org_setup", "platform", "task"])
export type Blame = z.infer<typeof blame>

/** Whether a person kicked a run off, or automation did. Adoption only counts `person` runs. */
export const trigger = z.enum(["person", "automation"])
export type Trigger = z.infer<typeof trigger>

/** Why one model reply stopped. */
export const turnFinishReason = z.enum(["stop", "tool_call", "length", "error"])
export type TurnFinishReason = z.infer<typeof turnFinishReason>

/** How a tool call ended. */
export const toolCallOutcome = z.enum(["success", "error", "timeout"])
export type ToolCallOutcome = z.infer<typeof toolCallOutcome>

/** What kind of thing a run produced. */
export const artifactKind = z.enum(["pull_request", "commit", "file", "report"])
export type ArtifactKind = z.infer<typeof artifactKind>

/** Which rule an agent tripped. See docs/metrics.md Group 5. */
export const policyFlagKind = z.enum([
  "suspected_prompt_injection",
  "goal_hijacked",
  "unsafe_tool_use",
  "excess_access_requested",
  "blocked_domain_attempt",
  "secret_exposed",
  "unsafe_command",
  "attempted_exfiltration",
  "spend_cap_crossed",
])
export type PolicyFlagKind = z.infer<typeof policyFlagKind>

/** How bad a flag is. */
export const severity = z.enum(["low", "medium", "high"])
export type Severity = z.infer<typeof severity>

/** What happened to a flag after it was raised. */
export const disposition = z.enum(["confirmed", "expected_and_dismissed", "under_review"])
export type Disposition = z.infer<typeof disposition>

/** Which bucket a seat falls into, worked out over a trailing 30 days. See docs/metrics.md Group 1. */
export const depthOfUseBucket = z.enum(["deep", "regular", "light", "dormant"])
export type DepthOfUseBucket = z.infer<typeof depthOfUseBucket>

// No enum for "agent kind" here on purpose. docs/data-model.md defines runs.agent_kind as plain
// TEXT with no CHECK list (unlike every other column above), and docs/api.md treats it the same
// way -- `agentKind?: string // e.g. "code-fix"` -- with GET /api/filter-options handing back
// whatever kinds actually exist in the seeded data. It's a real, open string everywhere it shows
// up in this package (see filters.ts), not a closed list.
