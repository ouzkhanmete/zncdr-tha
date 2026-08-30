// Money display helpers that only ever take whole cents in -- see packages/shared's `cents`
// schema and docs/api.md: "Money is a whole number of cents ... Never a decimal." Keeping every
// amount as an integer until the one, final formatting step is what keeps a dashboard full of
// summed and re-summed money from drifting the way dollar-as-float arithmetic does: 1.005 rounds
// the wrong way in a plain JS float (see money.test.ts), but 100 whole cents never has a ".5 of a
// cent" to round in the first place.

function assertWholeCents(cents: number, fn: string): void {
  if (!Number.isInteger(cents)) {
    throw new Error(`${fn} got ${cents}, which isn't a whole number. Money is whole cents only.`)
  }
}

/**
 * A headline dollar figure with no cents shown, e.g. `1_240_000 -> "$12,400"`. Used for the big
 * stat numbers (money spent, value returned) where a page full of ".00" adds noise without
 * adding information. Throws on a non-integer input rather than silently formatting a value that
 * already drifted upstream.
 */
export function formatDollarsWhole(cents: number): string {
  assertWholeCents(cents, "formatDollarsWhole")
  const sign = cents < 0 ? "-" : ""
  const whole = Math.round(Math.abs(cents) / 100)
  return `${sign}$${whole.toLocaleString("en-US")}`
}

/**
 * The full-precision form, e.g. `4250 -> "$42.50"`. For sub-cent line items (a per-token-type
 * cost, where the amount is the result of tokens × a per-million-token rate and can genuinely
 * fall between whole cents before the run's total is rounded), pass a `decimals` override.
 */
export function formatDollarsAndCents(cents: number, decimals = 2): string {
  if (decimals === 2) assertWholeCents(cents, "formatDollarsAndCents")
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(cents / 100)
}
