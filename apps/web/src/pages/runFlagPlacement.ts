// Where a run's rule flags belong on the run detail screen -- docs/api.md's `RunPolicyFlag.turnId`
// callout: a flag with a turn id lands on that turn's row in the "Turn by turn" breakdown *in
// addition to* the run-level "Rules" card; a flag with no turn id (some rules, like a spend cap
// crossed, are true of the run as a whole, with no single turn responsible) only ever shows up in
// the run-level card, because there is nowhere else honest to put it. Kept as plain functions, not
// inlined in the component, so the placing logic can be tested without rendering anything -- see
// runFlagPlacement.test.ts.

import type { RunPolicyFlag, Severity } from "@app/shared"

/** Every flag that can be placed on a turn, grouped by that turn's id. A flag with `turnId: null`
 *  never appears here -- it stays run-level only, per the callout above. */
export function groupFlagsByTurn(policyFlags: readonly RunPolicyFlag[]): Map<string, RunPolicyFlag[]> {
  const byTurn = new Map<string, RunPolicyFlag[]>()
  for (const flag of policyFlags) {
    if (flag.turnId === null) continue
    const list = byTurn.get(flag.turnId)
    if (list) list.push(flag)
    else byTurn.set(flag.turnId, [flag])
  }
  return byTurn
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 }

/** The single severity that should decide a turn row's colour, when it carries more than one
 *  flag -- docs/ui.md reserves red for what someone must act on now, so one high-severity flag
 *  among several low ones still has to read as high, never averaged down. `null` for no flags. */
export function worstSeverity(flags: readonly RunPolicyFlag[]): Severity | null {
  let worst: Severity | null = null
  for (const flag of flags) {
    if (worst === null || SEVERITY_RANK[flag.severity] > SEVERITY_RANK[worst]) worst = flag.severity
  }
  return worst
}
