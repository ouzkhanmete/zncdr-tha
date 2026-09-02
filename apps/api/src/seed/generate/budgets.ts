import type { Rng } from "../rng.ts"
import {
  ATLAS_BUDGET,
  CURRENT_MONTH,
  CURRENT_MONTH_START_MS,
  DATA_END_MS,
  DAY_MS,
  DAYS_IN_CURRENT_MONTH,
  NOVA_BUDGET,
  TOTAL_DAYS,
  toIso,
} from "../config.ts"
import type { GeneratedTeam } from "./org.ts"
import type { GeneratedRun, GeneratedToolCall, GeneratedTurn } from "./runs.ts"

// How far back from day 180 (today) to look when sizing an ordinary team's limit off its own
// pace, rather than off however little of the current month has elapsed. Deliberately not tied
// to the calendar month boundary -- see `typicalDailySpendCents` below.
const RECENT_DAILY_SPEND_WINDOW_DAYS = 30

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
 * A team's average daily cost over its most recent `windowDays`, ending at day 180 (today) --
 * *not* clipped to the current calendar month. A monthly limit is something a budget owner signs
 * off on for the month ahead; it doesn't shrink because the month happens to be two days old. See
 * the note on `generateBudgets` below for the bug this replaced.
 *
 * Clipped to how long the team has actually existed, so a team adopted more recently than
 * `windowDays` ago (Pinnacle, at 15-16 days old by day 180) doesn't get divided by 30 days of
 * which half never had a chance to have any spend -- that would halve its apparent daily rate and
 * undersize its limit right when its own recent activity is all there is to go on.
 */
function typicalDailySpendCents(runs: readonly GeneratedRun[], teamId: number, adoptionDay: number, windowDays: number): number {
  const daysActive = TOTAL_DAYS - adoptionDay + 1
  const effectiveWindowDays = Math.max(1, Math.min(windowDays, daysActive))
  const windowStartMs = DATA_END_MS - effectiveWindowDays * DAY_MS
  const total = runs
    .filter((r) => r.teamId === teamId && r.startedAtMs >= windowStartMs && r.startedAtMs < DATA_END_MS)
    .reduce((sum, r) => sum + r.totalCostCents, 0)
  return total / effectiveWindowDays
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
 * their named story; every other team gets a limit sized off its own typical daily spend, not off
 * this month's organic spend-to-date.
 *
 * That distinction matters because of the rolling anchor in config.ts: the current month can be
 * anywhere from a single day old to nearly a full month old. A limit sized off spend-to-date
 * (`organic / utilization`, as this used to read) is really "spend-to-date, inflated a bit" --
 * fine when spend-to-date already covers ~28 days, but on a 2-day-old month it produces a
 * "monthly" limit like $50 for a 40-person team, and every team's burn pace comes out looking
 * like it's already 5-15x over pace, because the limit itself was only ever sized for two days.
 * The whole point of the burn-pace chart -- 80% spent on day 10 means something different than
 * 80% spent on day 28 -- collapses if the limit moves with the calendar too. Sizing off a
 * trailing daily average instead keeps the limit stable regardless of what day the seed runs on,
 * so an ordinary team's pace reads as roughly on track (spend-to-date tracking day-of-month, both
 * small early in the month) instead of permanently alarming.
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
    } else {
      const dailyAvg = typicalDailySpendCents(runs, team.id, team.adoptionDay, RECENT_DAILY_SPEND_WINDOW_DAYS)
      if (dailyAvg > 0) {
        // `utilization` is the fraction of a full month's limit a team is meant to have used by
        // month end -- 35-75%, always comfortably under the 80% warning line. Projecting the
        // recent daily average across the *actual* number of days in this calendar month (28-31,
        // not a flat 30) means limit-so-far tracks day-of-month the same way spend-so-far does,
        // so their ratio stays near `utilization` whether the seed runs on day 2 or day 29.
        //
        // Rounded UP to the nearest $50, never down: rounding down could shave just enough off
        // the limit to push an early, still-small spend-to-date back over it by coincidence --
        // the exact failure this produced for Anchor before this was sized off a daily average.
        const utilization = rng.float(0.35, 0.75)
        limitCents = Math.max(5_000, Math.ceil((dailyAvg * DAYS_IN_CURRENT_MONTH) / utilization / 5_000) * 5_000)
      } else {
        limitCents = 5_000 // a nominal floor for a team with no recent spend at all
      }
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
