/**
 * The two ways this product turns a pile of numbers into one number.
 *
 * Both match, exactly, the SQL in docs/data-model.md section 4. That SQL is the definition;
 * this is where the code does it (see docs/decisions.md entry 10). If the two ever disagree,
 * stats.test.ts fails — it runs both against the same rows and compares.
 */

/**
 * The middle value. For an even count, the average of the two middle ones.
 *
 * Used as the headline for cost per finished task, because most runs are cheap and a few are
 * wild — an average would report a typical task costing several dollars when the typical task
 * costs pennies.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  // Same trick as the SQL: for an odd count both land on the middle row; for an even count
  // they land on the two middle rows and get averaged.
  const lower = sorted[Math.ceil(n / 2) - 1]!
  const upper = sorted[Math.ceil((n + 1) / 2) - 1]!
  return (lower + upper) / 2
}

/**
 * The value that `share` of the numbers come in at or under — p95 for share 0.95.
 *
 * Worked out over the raw values in one pass, never by averaging other percentiles. Averaging
 * percentiles is not slightly wrong, it is arbitrarily wrong: a published example had the
 * average of per-host p99s reading 550ms when the real figure was 1000ms.
 */
export function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null
  if (share <= 0) return Math.min(...values)
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  // Matches CUME_DIST: the smallest value whose running share of the rows reaches `share`.
  // Ties matter — with [1,1,2] the share at the second 1 is already 2/3, not 1/3.
  for (let i = 0; i < n; i++) {
    let last = i
    while (last + 1 < n && sorted[last + 1] === sorted[i]) last++
    if ((last + 1) / n >= share) return sorted[i]!
    i = last
  }
  return sorted[n - 1]!
}
