/**
 * Every id on the wire is a short string (docs/api.md: "An id is a short string. Nothing below
 * assumes a particular id format"). Every id in the database is the table's own
 * `INTEGER PRIMARY KEY` (docs/data-model.md). This file is the one place that boundary is
 * crossed, so a wire id becomes the same kind of number everywhere instead of each controller
 * inventing its own `Number(...)` and its own idea of what counts as valid.
 *
 * A malformed id ("abc", "-1", "1.5") and a well-formed id that just doesn't exist both come back
 * from a resolver below as "not found" -- docs/api.md's error table only has one bucket for
 * either case: "An id in the path does not match anything," 404.
 */

import type { EngineerRepository } from "../repositories/engineers.ts"
import type { TeamRepository } from "../repositories/teams.ts"

/** A positive integer, written with no leading zero, and nothing else -- the only shape an
 *  `INTEGER PRIMARY KEY AUTOINCREMENT` column ever hands out. `null` for anything else, including
 *  `"0"`, `"-1"`, `"1.5"`, and `""`. */
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

/** Resolves an optional wire team id into the numeric id every repository expects. Three
 *  outcomes: no id was given at all (fine -- most callers treat that as "the whole org"); the id
 *  resolved to a real team; or it didn't, which the caller turns into a 404. */
export function resolveOptionalTeamId(teams: TeamRepository, orgId: number, wireId: string | undefined):
  | { found: true; teamId: number | undefined }
  | { found: false } {
  if (wireId === undefined) return { found: true, teamId: undefined }
  const id = parseId(wireId)
  const team = id === null ? undefined : teams.findById(id)
  if (!team || team.orgId !== orgId) return { found: false }
  return { found: true, teamId: team.id }
}

/** Same as `resolveOptionalTeamId`, for a path segment that must name a real team -- every
 *  `:teamId` route. */
export function resolveRequiredTeamId(teams: TeamRepository, orgId: number, wireId: string): number | undefined {
  const id = parseId(wireId)
  const team = id === null ? undefined : teams.findById(id)
  return team && team.orgId === orgId ? team.id : undefined
}

export function resolveEngineerId(engineers: EngineerRepository, orgId: number, wireId: string): number | undefined {
  const id = parseId(wireId)
  const engineer = id === null ? undefined : engineers.findById(id)
  return engineer && engineer.orgId === orgId ? engineer.id : undefined
}
