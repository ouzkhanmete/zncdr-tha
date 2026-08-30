import type { Rng } from "../rng.ts"
import { DOMINANT_FAILURE_CAUSE, DOMINANT_FAILURE_SHARE, DOMINANT_FAILURE_TEAM } from "../config.ts"

export type FailureBlame = "org_setup" | "platform" | "task"

const BLAMES = ["org_setup", "platform", "task"] as const

/** The twelve causes from docs/metrics.md Group 4, grouped under whose problem each one is. */
const CAUSES_BY_BLAME: Record<FailureBlame, readonly string[]> = {
  org_setup: [
    "missing_permission",
    "missing_secret_or_login",
    "tool_not_available",
    "network_or_sandbox_blocked",
    "hit_token_or_time_limit",
  ],
  platform: ["ran_out_of_context", "infrastructure_crash", "rate_limited"],
  task: ["dependency_install_failed", "model_refused", "tests_failed", "nothing_useful_produced"],
}

/**
 * Share of a team's failures landing in each blame bucket, by how many days into its own
 * adoption it is -- see docs/seed-data.md: org-setup mistakes dominate a team's first 30 days,
 * task failures take over after that, and platform stays a steady background rate throughout.
 *
 * `DOMINANT_FAILURE_TEAM` leans even harder on org-setup while it's inside that first-30-days
 * window than the org-wide 50% -- it's a small, very new team, and its whole short history so far
 * is a real team still fighting the same setup problem, not yet into the phase where task
 * failures would normally take over.
 */
export function blameWeights(teamAgeDays: number, teamName?: string): Record<FailureBlame, number> {
  if (teamName === DOMINANT_FAILURE_TEAM && teamAgeDays < 30) return { org_setup: 75, platform: 10, task: 15 }
  if (teamAgeDays < 30) return { org_setup: 50, platform: 13, task: 37 }
  return { org_setup: 10, platform: 15, task: 75 }
}

/**
 * `teamName` matters two ways, both only for `DOMINANT_FAILURE_TEAM` (see NEW_TEAM_STRUGGLE and
 * docs/seed-data.md): its failures skew even further toward org-setup than a new team normally
 * would (`blameWeights` above), and within org-setup, most of them repeat one fixed cause instead
 * of being spread evenly across all five -- so the team screen's "one cause dominates this team's
 * org-setup failures" callout has something real, and not wafer-thin, to point at.
 */
export function pickFailure(rng: Rng, teamAgeDays: number, teamName: string): { blame: FailureBlame; failureCause: string } {
  const weights = blameWeights(teamAgeDays, teamName)
  const blame = rng.weightedPick(BLAMES, [weights.org_setup, weights.platform, weights.task])
  if (blame === "org_setup" && teamName === DOMINANT_FAILURE_TEAM && rng.chance(DOMINANT_FAILURE_SHARE)) {
    return { blame, failureCause: DOMINANT_FAILURE_CAUSE }
  }
  const failureCause = rng.pick(CAUSES_BY_BLAME[blame])
  return { blame, failureCause }
}

/** `hit_token_or_time_limit` is the one cause that means the run timed out, not plainly failed. */
export function statusForFailureCause(cause: string): "failed" | "timed_out" {
  return cause === "hit_token_or_time_limit" ? "timed_out" : "failed"
}
