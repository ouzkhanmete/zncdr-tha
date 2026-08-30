// The "teams, compared fairly" scatter on the org page (docs/ui.md) plots each team's success
// rate against its run count, with a shaded band showing the spread luck alone would produce at
// that run count. A small team's one bad run is noise; the same rate from a 900-run team is
// signal. This is a plain Wald confidence interval around the org's own rate, narrowing as the
// sample (run count) grows -- the same idea docs/api.md's `/comparison` endpoint's `band` field
// describes, just computed here for the org page's all-teams view rather than one team at a time.

export type ExpectedRange = { low: number; high: number }

/**
 * The range of success rates you'd expect from a team of this size, purely from luck, if its
 * true rate matched the org's. `z = 1.96` is the usual 95% band. Clamped to [0, 1] since a rate
 * can't leave that range.
 */
export function expectedRange(orgRate: number, runCount: number, z = 1.96): ExpectedRange {
  if (runCount <= 0) return { low: 0, high: 1 }
  const halfWidth = z * Math.sqrt((orgRate * (1 - orgRate)) / runCount)
  return {
    low: Math.max(0, orgRate - halfWidth),
    high: Math.min(1, orgRate + halfWidth),
  }
}

export function isOutsideRange(rate: number, range: ExpectedRange): boolean {
  return rate < range.low || rate > range.high
}
