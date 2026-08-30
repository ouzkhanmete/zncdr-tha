import type { Rng } from "../rng.ts"
import { ENGINEER_UTC_OFFSETS_MINUTES, FIRST_NAMES, LAST_NAMES, ORG_START_MS, TEAM_MOVE, TEAMS, toIso } from "../config.ts"

export type UsageTier = "deep" | "regular" | "light"

export interface GeneratedOrg {
  id: number
  name: string
  licensedSeats: number
  createdAt: string
}

export interface GeneratedTeam {
  id: number
  orgId: number
  name: string
  adoptionDay: number
  usageIntensity: number
  createdAt: string
}

export interface GeneratedEngineer {
  id: number
  orgId: number
  teamId: number
  handle: string
  displayName: string
  seatGrantedAt: string
  seatActive: boolean
  utcOffsetMinutes: number
  /** Never starts a single run, on purpose -- see docs/seed-data.md's dormant-seat story. */
  dormant: boolean
  /** Meaningless when `dormant`. Which depth-of-use band this person's personal rate lands in. */
  tier: UsageTier
  /** This person's average number of runs on an ordinary weekday, before team or ramp effects. */
  weekdayMeanRuns: number
  /**
   * Set only for the one engineer TEAM_MOVE picks (see config.ts). `teamId` above always holds
   * where they are *now* -- this holds where they came from, and the first day (inclusive) a run
   * counts toward the new team instead of the old one. Every other engineer leaves this unset and
   * has exactly one team for their whole history.
   */
  move?: { previousTeamId: number; moveDay: number }
}

export interface GeneratedOrgData {
  org: GeneratedOrg
  teams: GeneratedTeam[]
  engineers: GeneratedEngineer[]
}

function pickTier(rng: Rng): UsageTier {
  return rng.weightedPick(["deep", "regular", "light"], [15, 35, 50])
}

function weekdayMeanForTier(rng: Rng, tier: UsageTier): number {
  switch (tier) {
    case "deep":
      return rng.float(1.6, 4.4)
    case "regular":
      return rng.float(0.36, 1.3)
    case "light":
      return rng.float(0.04, 0.28)
  }
}

/** Builds a unique `f.last` handle, appending a number the rare time two people would collide. */
function makeHandle(rng: Rng, taken: Set<string>): { handle: string; displayName: string } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = rng.pick(FIRST_NAMES)
    const last = rng.pick(LAST_NAMES)
    const base = `${first[0]!.toLowerCase()}.${last.toLowerCase()}`
    if (!taken.has(base)) {
      taken.add(base)
      return { handle: base, displayName: `${first} ${last}` }
    }
  }
  // Every pool combination is somehow taken -- fall back to a numbered handle rather than loop forever.
  let n = 2
  const first = rng.pick(FIRST_NAMES)
  const last = rng.pick(LAST_NAMES)
  let handle = `${first[0]!.toLowerCase()}.${last.toLowerCase()}${n}`
  while (taken.has(handle)) {
    n++
    handle = `${first[0]!.toLowerCase()}.${last.toLowerCase()}${n}`
  }
  taken.add(handle)
  return { handle, displayName: `${first} ${last}` }
}

/**
 * Picks the one engineer TEAM_MOVE describes and moves them: `teamId` becomes where they are
 * now, `move` records where they came from and when the switch happened. Picked deterministically
 * (first eligible engineer in generation order, not dormant, not the lightest tier) so the fixed
 * seed still gives identical output every run -- this reads already-generated state rather than
 * drawing any new random numbers, so it doesn't perturb anything generated before or after it.
 */
function applyTeamMove(engineers: GeneratedEngineer[], teams: readonly GeneratedTeam[]): void {
  const fromTeam = teams.find((t) => t.name === TEAM_MOVE.fromTeam)
  const toTeam = teams.find((t) => t.name === TEAM_MOVE.toTeam)
  if (!fromTeam || !toTeam) throw new Error("TEAM_MOVE.fromTeam/toTeam must name real teams")

  const mover = engineers.find((e) => e.teamId === fromTeam.id && !e.dormant && e.tier !== "light")
  if (!mover) throw new Error("no eligible engineer found to satisfy TEAM_MOVE")

  mover.move = { previousTeamId: fromTeam.id, moveDay: TEAM_MOVE.moveDay }
  mover.teamId = toTeam.id
}

/**
 * Builds the org, its 8 teams, and its 130 engineers. Ids are assigned here, in the exact order
 * rows will later be inserted, so an in-memory foreign key (an engineer's `teamId`) already
 * matches the id SQLite will hand the real row -- see insert.ts.
 */
export function generateOrg(rng: Rng): GeneratedOrgData {
  const totalSeats = TEAMS.reduce((sum, t) => sum + t.engineers, 0)

  const org: GeneratedOrg = {
    id: 1,
    name: "Fenwick Systems",
    licensedSeats: totalSeats,
    createdAt: "2019-04-01T00:00:00Z",
  }

  const teams: GeneratedTeam[] = TEAMS.map((config, index) => ({
    id: index + 1,
    orgId: org.id,
    name: config.name,
    adoptionDay: config.adoptionDay,
    usageIntensity: config.usageIntensity,
    // A team predates its tool adoption day by some months to a few years -- team formation and
    // "started using the product" are different events.
    createdAt: toIso(new Date(Date.UTC(2019, 0, 1) + rng.int(0, 6 * 365) * 86_400_000)),
  }))

  const takenHandles = new Set<string>()
  const engineers: GeneratedEngineer[] = []
  let nextId = 1

  TEAMS.forEach((config, teamIndex) => {
    const team = teams[teamIndex]!
    const dormantCount = Math.round(config.engineers * config.dormantRate)
    // Which slots (0-indexed within the team) are dormant, chosen without replacement.
    const dormantSlots = new Set(rng.shuffle([...Array(config.engineers).keys()]).slice(0, dormantCount))

    for (let slot = 0; slot < config.engineers; slot++) {
      const { handle, displayName } = makeHandle(rng, takenHandles)
      const dormant = dormantSlots.has(slot)
      const tier = pickTier(rng)

      // Most seats are granted in a staggered rollout over the team's first two weeks; a smaller
      // share are later hires, granted a seat any time up to the end of the window -- some of
      // those land right near day 180, which is exactly why they still look untouched.
      const grantDay = rng.chance(0.8)
        ? config.adoptionDay + rng.int(0, 14)
        : rng.int(config.adoptionDay + 15, 180)
      const grantDate = new Date(
        ORG_START_MS + (Math.min(grantDay, 180) - 1) * 86_400_000 + rng.int(0, 86_399) * 1000,
      )

      engineers.push({
        id: nextId++,
        orgId: org.id,
        teamId: team.id,
        handle,
        displayName,
        seatGrantedAt: toIso(grantDate),
        seatActive: true,
        utcOffsetMinutes: rng.pick(ENGINEER_UTC_OFFSETS_MINUTES),
        dormant,
        tier,
        weekdayMeanRuns: weekdayMeanForTier(rng, tier),
      })
    }
  })

  applyTeamMove(engineers, teams)

  return { org, teams, engineers }
}
