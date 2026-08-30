import { dateForDay, toIso } from "../config.ts"

/** One priced row, exactly as it will land in the `models` table. */
export interface GeneratedModel {
  id: number
  provider: string
  name: string
  inputPricePerMtokCents: number
  cachedInputPricePerMtokCents: number
  cacheWritePricePerMtokCents: number
  outputPricePerMtokCents: number
  effectiveFrom: string
  // Internal to the generator, not written to the table:
  effectiveFromDay: number
  availableFromDay: number
  /** Last day a *new* run may be assigned this model. `null` means still available at day 180. */
  availableToDay: number | null
}

/**
 * Cached-read and cache-write prices are always derived from the input price, matching the
 * "roughly a tenth" and "a bit above input" shape docs/metrics.md describes -- one place to
 * change the ratio instead of four hand-typed numbers that could quietly drift apart.
 */
function priceRow(
  id: number,
  provider: string,
  name: string,
  inputPricePerMtokCents: number,
  outputPricePerMtokCents: number,
  effectiveFromDay: number,
  availableFromDay: number,
  availableToDay: number | null,
): GeneratedModel {
  return {
    id,
    provider,
    name,
    inputPricePerMtokCents,
    cachedInputPricePerMtokCents: Math.round(inputPricePerMtokCents / 10),
    cacheWritePricePerMtokCents: Math.round(inputPricePerMtokCents * 1.25),
    outputPricePerMtokCents,
    effectiveFrom: toIso(dateForDay(effectiveFromDay)),
    effectiveFromDay,
    availableFromDay,
    availableToDay,
  }
}

/** Model rows, in the order they land in the table -- ids below match that order. */
export function generateModels(): GeneratedModel[] {
  return [
    // Cheap, older. Used the first 45 days, then never assigned to a new run again -- the row
    // stays because old runs still point at it.
    priceRow(1, "fenwick-labs", "legacy-helper", 80, 400, -1000, 1, 45),

    // Cheap and fast, used the whole window, and the least reliable -- see failure weighting in
    // generate/runs.ts. Its price drops about 30% on day 100.
    priceRow(2, "fenwick-labs", "quickpatch-1", 50, 250, -1000, 1, null),
    priceRow(3, "fenwick-labs", "quickpatch-1", 35, 175, 100, 1, null),

    // The middle option: steady price, steady quality, used the whole window.
    priceRow(4, "fenwick-labs", "steady-coder", 300, 1500, -1000, 1, null),

    // Expensive, thinking-heavy, didn't exist before day 60, and the most reliable of the four.
    priceRow(5, "meridian-ai", "deep-thinker", 1500, 7500, 60, 60, null),
  ]
}

/** Every distinct model name that has ever existed, in generation order. */
export function modelNames(models: readonly GeneratedModel[]): string[] {
  return [...new Set(models.map((m) => m.name))]
}

/** Which model names a brand new run may be assigned on the given day. */
export function availableModelNames(models: readonly GeneratedModel[], day: number): string[] {
  return modelNames(
    models.filter((m) => day >= m.availableFromDay && (m.availableToDay === null || day <= m.availableToDay)),
  )
}

/**
 * The exact priced row in effect for a model name at a given moment -- "a turn is priced at the
 * rate in effect when it ran" (docs/metrics.md), so this always picks the generation with the
 * latest `effectiveFrom` that is still at or before `at`.
 */
export function priceRowFor(models: readonly GeneratedModel[], name: string, at: Date): GeneratedModel {
  const candidates = models.filter((m) => m.name === name && dateForDay(m.effectiveFromDay) <= at)
  if (candidates.length === 0) throw new Error(`no priced row for model ${name} at ${at.toISOString()}`)
  return candidates.reduce((latest, m) => (m.effectiveFromDay > latest.effectiveFromDay ? m : latest))
}
