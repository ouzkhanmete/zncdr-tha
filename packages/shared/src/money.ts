import { z } from "zod"

// Money is always a whole number of cents, in an integer. Never a float, no exceptions -- see
// docs/data-model.md and docs/metrics.md. Every money field in this package uses this schema
// instead of a bare z.number(), so a stray float fails validation the same way everywhere.
export const cents = z.number().int().nonnegative()
export type Cents = z.infer<typeof cents>

/**
 * Adds up a list of whole-cent amounts. Plain integer addition, nothing clever -- which is the
 * point: money stored and summed as integers can't drift depending on what order you add it in,
 * the way it would if a cent ever became a float along the way.
 */
export function sumCents(amounts: number[]): number {
  let total = 0
  for (const amount of amounts) {
    if (!Number.isInteger(amount)) {
      throw new Error(`sumCents got ${amount}, which isn't a whole number. Money is whole cents only.`)
    }
    total += amount
  }
  return total
}

/** Turns whole cents into a dollar string for display, e.g. 4250 -> "$42.50". */
export function formatCents(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new Error(`formatCents got ${amount}, which isn't a whole number. Money is whole cents only.`)
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100)
}
