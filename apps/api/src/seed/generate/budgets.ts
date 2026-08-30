import type { Rng } from "../rng.ts"
import { ATLAS_BUDGET, CURRENT_MONTH, CURRENT_MONTH_START_MS, DATA_END_MS, NOVA_BUDGET, toIso } from "../config.ts"
import type { GeneratedTeam } from "./org.ts"
import type { GeneratedRun, GeneratedToolCall, GeneratedTurn } from "./runs.ts"

export interface GeneratedBudget {
  id: number
  teamId: number
  month: string
  limitCents: number
  warnCents: number
  stopCents: number
  updatedAt: string
}

function isInCurrentMonth(run: GeneratedRun): boolean {
  return run.startedAtMs >= CURRENT_MONTH_START_MS && run.startedAtMs < DATA_END_MS
}

function currentMonthSpend(runs: readonly GeneratedRun[], teamId: number): number {
  return runs
    .filter((r) => r.teamId === teamId && isInCurrentMonth(r))
    .reduce((sum, r) => sum + r.totalCostCents, 0)
}

/**
 * Nova and Atlas's this-month spend is named to the dollar in docs/seed-data.md. Everything else
 * about their runs -- volume, timing, which ones failed -- is generated the same organic way as
 * every other team; this just nudges the one number the story is pinned to, by scaling every
 * turn and tool call cost within that team's current-month runs by the same factor and then
 * re-summing each run's total from its (now scaled) children. Scaling preserves the shape of the
 * long tail -- a run that cost ten times another still does -- it only moves the total.
 */
function scaleTeamCurrentMonthCost(
  runs: GeneratedRun[],
  turns: GeneratedTurn[],
  toolCalls: GeneratedToolCall[],
  teamId: number,
  factor: number,
): void {
  const affectedRunIds = new Set(
    runs.filter((r) => r.teamId === teamId && isInCurrentMonth(r)).map((r) => r.id),
  )
  for (const turn of turns) {
    if (affectedRunIds.has(turn.runId)) turn.costCents = Math.max(0, Math.round(turn.costCents * factor))
  }
  for (const call of toolCalls) {
    if (affectedRunIds.has(call.runId)) call.costCents = Math.max(0, Math.round(call.costCents * factor))
  }

  const turnSumByRun = new Map<number, number>()
  for (const turn of turns) {
    if (!affectedRunIds.has(turn.runId)) continue
    turnSumByRun.set(turn.runId, (turnSumByRun.get(turn.runId) ?? 0) + turn.costCents)
  }
  const toolSumByRun = new Map<number, number>()
  for (const call of toolCalls) {
    if (!affectedRunIds.has(call.runId)) continue
    toolSumByRun.set(call.runId, (toolSumByRun.get(call.runId) ?? 0) + call.costCents)
  }
  for (const run of runs) {
    if (!affectedRunIds.has(run.id)) continue
    run.totalCostCents = (turnSumByRun.get(run.id) ?? 0) + (toolSumByRun.get(run.id) ?? 0)
  }
}

/**
 * One budget row per team, for the current month only -- docs/seed-data.md calls for "one row
 * per team, holding this month's dollar limit," not a full history. Nova and Atlas are pinned to
 * their named story; every other team gets a limit sized so this month's organic spend lands
 * somewhere plausibly comfortable, not suspiciously round.
 */
export function generateBudgets(
  rng: Rng,
  teams: readonly GeneratedTeam[],
  runs: GeneratedRun[],
  turns: GeneratedTurn[],
  toolCalls: GeneratedToolCall[],
): GeneratedBudget[] {
  const updatedAt = toIso(new Date(DATA_END_MS - 60_000))
  const budgets: GeneratedBudget[] = []

  teams.forEach((team, index) => {
    const organic = currentMonthSpend(runs, team.id)
    let limitCents: number

    if (team.name === "Nova") {
      if (organic > 0) scaleTeamCurrentMonthCost(runs, turns, toolCalls, team.id, NOVA_BUDGET.targetSpentCents / organic)
      limitCents = NOVA_BUDGET.limitCents
    } else if (team.name === "Atlas") {
      if (organic > 0) scaleTeamCurrentMonthCost(runs, turns, toolCalls, team.id, ATLAS_BUDGET.targetSpentCents / organic)
      limitCents = ATLAS_BUDGET.limitCents
    } else if (organic > 0) {
      const utilization = rng.float(0.35, 0.75)
      limitCents = Math.max(5_000, Math.round(organic / utilization / 5_000) * 5_000)
    } else {
      limitCents = 5_000 // a nominal floor for a team with no spend yet this month
    }

    const warnCents = Math.round(limitCents * 0.8)
    budgets.push({
      id: index + 1,
      teamId: team.id,
      month: CURRENT_MONTH,
      limitCents,
      warnCents,
      stopCents: limitCents,
      updatedAt,
    })
  })

  return budgets
}
