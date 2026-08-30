/**
 * A small, seedable random number generator (mulberry32).
 *
 * `Math.random()` cannot be seeded, so two runs of the seed script could never agree. Every
 * random choice the generator makes -- which team, which hour, how many tokens -- has to come
 * from one of these instead, so the whole 180-day dataset comes out byte-for-byte identical
 * every time it runs from the same seed (see docs/seed-data.md).
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Whole number in [min, max], both ends included. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min
  }

  /** True with the given probability (0..1). */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  /** One item from a list, every item equally likely. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)]
    if (item === undefined) throw new Error("pick called on an empty list")
    return item
  }

  /** One item from a list, each weighted by the matching entry in `weights`. */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((sum, w) => sum + w, 0)
    let roll = this.next() * total
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!
      if (roll <= 0) return items[i]!
    }
    return items[items.length - 1]!
  }

  /** A shuffled copy of the array (Fisher-Yates), original left untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = items.slice()
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
    }
    return copy
  }

  /**
   * A whole number of events drawn from a Poisson distribution with the given mean.
   * Used for "how many runs did this engineer start today" style counts, where most days are
   * quiet and a few are busy -- the shape a real usage count actually has, unlike a flat average.
   * Knuth's algorithm: fine at the small means (under ~30) this generator ever asks for.
   */
  poisson(mean: number): number {
    if (mean <= 0) return 0
    const limit = Math.exp(-mean)
    let count = 0
    let product = 1
    do {
      count++
      product *= this.next()
    } while (product > limit)
    return count - 1
  }
}
