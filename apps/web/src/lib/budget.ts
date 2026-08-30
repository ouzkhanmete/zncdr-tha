// Budget burn pace. See docs/metrics.md's "Budget and burn pace" and docs/api.md's
// `budget-status` shape, which this mirrors: "pace: spent so far ÷ share of the month gone" and
// "landing on: pace projected to month end." A percent-used number alone can't tell day 10 from
// day 28 apart -- the whole point of a pace figure is that it can.

/**
 * How many calendar days a "YYYY-MM" month has, in UTC -- day 0 of the *next* month is always the
 * last day of *this* one. `BudgetStatusResponse.month` (packages/shared) is the only place a
 * month's own length needs working out; the burn chart uses it to draw a day-1..day-N axis.
 */
export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number)
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()
}

/** The day-of-month a "YYYY-MM-DD" date falls on, e.g. `"2026-08-18" -> 18`. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10))
}

/**
 * Where this month lands if spending keeps going at today's pace. Matches
 * `BudgetStatusResponse.projectedLandingCents` in packages/shared -- the server already returns
 * this number computed the same way; this copy exists for the team page's countdown text
 * (`daysUntilStopLine` below), which needs the same arithmetic client-side.
 *
 * `monthProgress` is the share of the month gone, 0 to 1. Before day one has actually elapsed
 * there's no pace to project from yet, so this just returns what's been spent so far rather than
 * dividing by (near) zero.
 */
export function projectedLandingCents(spentSoFarCents: number, monthProgress: number): number {
  if (monthProgress <= 0) return spentSoFarCents
  return Math.round(spentSoFarCents / monthProgress)
}

/**
 * The plain-language number docs/ui.md asks for on the team page: "with the actual number of
 * days that would blow past the stop line if it's heading there." Returns `null` when the
 * question doesn't apply -- there's no pace yet to extrapolate from, or spending has stalled and
 * will never reach the line. Returns `0` when the stop line has already been crossed.
 */
export function daysUntilStopLine(
  spentSoFarCents: number,
  monthProgress: number,
  totalDaysInMonth: number,
  stopCents: number,
): number | null {
  if (spentSoFarCents >= stopCents) return 0
  const daysElapsed = monthProgress * totalDaysInMonth
  if (daysElapsed <= 0) return null

  const dailyRateCents = spentSoFarCents / daysElapsed
  if (dailyRateCents <= 0) return null

  return Math.round((stopCents - spentSoFarCents) / dailyRateCents)
}
