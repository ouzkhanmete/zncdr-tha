/**
 * Group 1 -- Adoption: are people using it. See docs/metrics.md.
 *
 * The one idea every number here protects: divide by *seats*, never by people who happened to
 * try the product. Dividing by active users instead would make a rollout that mostly failed look
 * fine, because the people who gave up would simply disappear from the maths -- see
 * docs/metrics.md's callout under "Adoption rate" and docs/data-model.md's note on
 * `orgs.licensed_seats` vs. `engineers.seat_active` (two different numbers, kept in step by the
 * seed script and, later, real provisioning -- nothing in the schema forces them to agree).
 */

import type { AdoptionResponse, DepthOfUseBucket } from "@app/shared"
import type { EngineerRepository } from "../repositories/engineers.ts"
import type { OrgRepository } from "../repositories/orgs.ts"
import type { RunRepository } from "../repositories/runs.ts"
import type { ScopeFilters } from "../repositories/types.ts"

const DAY_MS = 24 * 60 * 60 * 1000

export interface AdoptionQuery {
  orgId: number
  /**
   * The anchor moment both rolling windows count back from. Unlike every other metrics endpoint,
   * `GET /api/metrics/adoption` takes no date range at all -- "fixed 7d/30d windows, no date
   * range" (docs/api.md) -- so there is no `to` already resolved on the wire the way
   * `reliability.ts`'s `to` anchors its own rolling windows. The caller supplies it instead; this
   * service holds no clock of its own.
   */
  now: string
  filters?: ScopeFilters
}

/** A run reduced to just the two fields depth-of-use's overlap check needs. */
interface RunInterval {
  startedAt: string
  finishedAt: string | null
}

function windowEndingAt(to: string, days: number): { from: string; to: string } {
  return { from: new Date(new Date(to).getTime() - days * DAY_MS).toISOString(), to }
}

/** A rate with nothing to divide by is 0, not NaN -- there is nothing wrong to report, and the
 *  count sitting next to the rate (see docs/metrics.md's "comparing teams" section) is what tells
 *  a reader "0 because nobody has a seat" apart from "0 because a real rollout failed". */
function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/** True if any two of a person's runs overlap in time -- "runs several agents at once" in
 *  docs/metrics.md's depth-of-use table. A run with no end yet is treated as running through
 *  `now`, since it is at least still open then even if it runs longer. Sorting by start first
 *  means only adjacent pairs need checking: if two consecutive runs never overlap, nothing
 *  further out can either, because every later run starts no earlier than the one right before
 *  it. */
function hasOverlappingRuns(runs: readonly RunInterval[], now: string): boolean {
  const sorted = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
  for (let i = 1; i < sorted.length; i++) {
    const previousEnd = sorted[i - 1]!.finishedAt ?? now
    if (sorted[i]!.startedAt < previousEnd) return true
  }
  return false
}

function bucketFor(runs: readonly RunInterval[], now: string): DepthOfUseBucket {
  if (runs.length === 0) return "dormant"
  if (runs.length >= 20 || hasOverlappingRuns(runs, now)) return "deep"
  if (runs.length >= 5) return "regular"
  return "light"
}

/** Narrows a run to the ones a person actually started -- automation runs carry no `engineerId`
 *  at all (docs/data-model.md: "Null when trigger is automation, since those runs have no person
 *  behind them"), so filtering those out *is* filtering to `trigger === "person"`, without
 *  needing a filter the repository interface doesn't expose. */
function isPersonRun<T extends { engineerId: number | null }>(run: T): run is T & { engineerId: number } {
  return run.engineerId !== null
}

export class AdoptionService {
  constructor(
    private readonly orgs: OrgRepository,
    private readonly engineers: EngineerRepository,
    private readonly runs: RunRepository,
  ) {}

  /**
   * The whole of docs/metrics.md Group 1 in one pass -- adoption rate (7d and 30d), depth of
   * use, and sticking rate all come from the same handful of repository calls, so a caller
   * building the org screen doesn't refetch the same rows three times over.
   */
  getAdoptionMetrics(query: AdoptionQuery): AdoptionResponse {
    const { orgId, now, filters } = query
    const org = this.orgs.findById(orgId)
    if (!org) throw new Error(`org ${orgId} not found`)

    const window7d = windowEndingAt(now, 7)
    const window30d = windowEndingAt(now, 30)

    // One fetch of every person-started run in the last 30 days covers adoption rate (both
    // windows, since 7d is a subset of 30d) and depth of use.
    const personRunsLast30d = this.runs.listStartedIn(orgId, window30d, filters).filter(isPersonRun)

    const activeLast30d = new Set(personRunsLast30d.map((r) => r.engineerId))
    const activeLast7d = new Set(
      personRunsLast30d.filter((r) => r.startedAt >= window7d.from).map((r) => r.engineerId),
    )

    // "Ever run anything" has no natural window of its own, so this asks for exactly the ids it
    // needs rather than every run ever started.
    const everRan = new Set(this.runs.everStartedEngineerIds(orgId, filters))

    const runsByEngineer = new Map<number, RunInterval[]>()
    for (const r of personRunsLast30d) {
      const intervals = runsByEngineer.get(r.engineerId) ?? []
      intervals.push({ startedAt: r.startedAt, finishedAt: r.finishedAt })
      runsByEngineer.set(r.engineerId, intervals)
    }

    // Depth of use buckets every *currently held* seat, not every seat ever bought -- a seat
    // that changed hands or was revoked is neither dormant nor deep, it just isn't a seat right
    // now. See docs/data-model.md's callout on `engineers.seat_active`.
    const activeSeats = this.engineers.listByOrgId(orgId).filter((e) => e.seatActive)
    const depthOfUse = { deep: 0, regular: 0, light: 0, dormant: 0, totalSeats: activeSeats.length }
    for (const engineer of activeSeats) {
      depthOfUse[bucketFor(runsByEngineer.get(engineer.id) ?? [], now)]++
    }

    return {
      adoptionRate: {
        last7d: { activeEngineers: activeLast7d.size, licensedSeats: org.licensedSeats, rate: safeRate(activeLast7d.size, org.licensedSeats) },
        last30d: { activeEngineers: activeLast30d.size, licensedSeats: org.licensedSeats, rate: safeRate(activeLast30d.size, org.licensedSeats) },
      },
      depthOfUse,
      stickingRate: {
        activeInLast7d: activeLast7d.size,
        everRun: everRan.size,
        // A different bottom on purpose -- see docs/metrics.md's "Sticking rate": this answers
        // "of the people who tried it, do they keep coming back", not "of everyone with a seat".
        rate: safeRate(activeLast7d.size, everRan.size),
      },
    }
  }
}
