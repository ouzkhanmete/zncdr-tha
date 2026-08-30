// Team page: "driven almost entirely by one thing" -- docs/ui.md asks for a plain-language
// callout when a single cause is doing most of the damage inside a failure-blame group, instead
// of leaving a reader to eyeball a list of causes and guess.

export type CauseCount<T extends string = string> = { cause: T; count: number }

export type DominantCause<T extends string = string> = { cause: T; share: number }

/**
 * Returns the cause responsible for most of a group's failures, if one clearly dominates
 * (>= `threshold` of the group's total), else `null`. A group split evenly across several causes
 * has no single thing to point at, so no callout should render for it.
 */
export function dominantCause<T extends string>(causes: CauseCount<T>[], threshold = 0.5): DominantCause<T> | null {
  const total = causes.reduce((sum, c) => sum + c.count, 0)
  if (total === 0) return null

  const top = causes.reduce((best, c) => (c.count > best.count ? c : best), causes[0] as CauseCount<T>)
  const share = top.count / total
  return share >= threshold ? { cause: top.cause, share } : null
}
