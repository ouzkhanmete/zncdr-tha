// The one number: money spent against value returned. See docs/product-brief.md.
//
// Two of the inputs are guesses a person can turn into a dial on screen (hours saved per task,
// cost of an engineer hour), so the server only ever hands back the raw pieces
// (packages/shared's SummaryResponse) and this file does the small bit of multiplying, live, as
// the dial moves -- no round trip needed, per docs/api.md section 11.

export type HeroInputs = {
  finishedTasks: number
  moneySpentCents: number
  hoursSavedPerTask: number
  engineerHourlyCostCents: number
}

export type HeroResult = {
  valueReturnedCents: number
  moneySpentCents: number
  netCents: number
  /**
   * The point where this pays for itself, stated in minutes saved per task -- see
   * docs/product-brief.md's "Say the break-even, not just the net." Falls out of the average
   * cost per finished task and the hourly rate alone, so unlike the net figure it does not move
   * when someone disagrees with the hours-saved dial. `null` when there's nothing finished yet,
   * or the hourly rate is zero, and so no break-even can be stated.
   */
  breakEvenMinutes: number | null
}

/**
 * Recomputes the hero numbers from whatever the two dials are currently set to.
 * `valueReturnedCents` is rounded to the nearest whole cent -- `hoursSavedPerTask` is a decimal
 * dial (e.g. 1.5), so the raw product of the three inputs is not always an integer, and money is
 * always a whole number of cents (see packages/shared's `cents` schema).
 */
export function computeHero(inputs: HeroInputs): HeroResult {
  const { finishedTasks, moneySpentCents, hoursSavedPerTask, engineerHourlyCostCents } = inputs

  const valueReturnedCents = Math.round(finishedTasks * hoursSavedPerTask * engineerHourlyCostCents)
  const netCents = valueReturnedCents - moneySpentCents

  let breakEvenMinutes: number | null = null
  if (finishedTasks > 0 && engineerHourlyCostCents > 0) {
    const averageCostPerTaskCents = moneySpentCents / finishedTasks
    breakEvenMinutes = (averageCostPerTaskCents / engineerHourlyCostCents) * 60
  }

  return { valueReturnedCents, moneySpentCents, netCents, breakEvenMinutes }
}
