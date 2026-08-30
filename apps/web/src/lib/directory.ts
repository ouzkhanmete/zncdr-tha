// Name lookups no metrics endpoint provides on its own. Every metrics/run/flag shape in
// docs/api.md carries ids, not display names (docs/api.md: "An id is a short string" -- names
// live only in `GET /api/teams` and `GET /api/filter-options`). Two small, cached directories
// built from those two calls are enough to answer every name lookup the four screens need.

import { getFilterOptions, getTeams } from "../api/index.ts"
import type { TeamListResponse } from "@app/shared"

let teamsCache: Promise<TeamListResponse> | null = null

/** `GET /api/teams`, fetched once per session and reused -- the whole list is small and the same
 *  answer for every caller, so there is no reason to ask again on every page. */
export function loadTeams(): Promise<TeamListResponse> {
  if (!teamsCache) teamsCache = getTeams()
  return teamsCache
}

export async function findTeamName(teamId: string): Promise<string | null> {
  const teams = await loadTeams()
  return teams.find((t) => t.id === teamId)?.name ?? null
}

export type EngineerIdentity = { id: string; name: string; teamId: string; teamName: string }

let engineerDirectoryCache: Promise<EngineerIdentity[]> | null = null

/**
 * No endpoint in docs/api.md answers "what is this engineer's name and team" from an id alone --
 * `GET /api/filter-options?team=X` only lists one *team's* engineers (section 3), and every
 * engineer-scoped call (section 6) takes an id and returns numbers, never a name. The Team page
 * already has an engineer's name for free, from its own roster call; a direct visit to an
 * Engineer or Run page does not. This builds the whole org's roster once, one small parallel
 * fetch per team -- a handful of teams, not the couple-hundred-row fan-out docs/api.md's own
 * `primaryOutputKind` note warns against for a run list -- and caches it for the session.
 *
 * ponytail: fine at this org's size. If team count ever grew past a few dozen, the real fix is a
 * dedicated name lookup (a `GET /api/engineers/:id`, or `teamId`/`teamName` added straight onto
 * `EngineerOverviewResponse`), not a bigger fan-out here.
 */
function loadEngineerDirectory(): Promise<EngineerIdentity[]> {
  if (!engineerDirectoryCache) {
    engineerDirectoryCache = loadTeams().then(async (teams) => {
      const rosters = await Promise.all(
        teams.map(async (team) => {
          const options = await getFilterOptions(team.id)
          return options.engineers.map((e) => ({ id: e.id, name: e.name, teamId: team.id, teamName: team.name }))
        }),
      )
      return rosters.flat()
    })
  }
  return engineerDirectoryCache
}

export async function findEngineer(engineerId: string): Promise<EngineerIdentity | null> {
  const directory = await loadEngineerDirectory()
  return directory.find((e) => e.id === engineerId) ?? null
}
