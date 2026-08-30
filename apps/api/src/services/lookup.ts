/**
 * The small lookup calls that fill in the filter bar and the team picker -- docs/api.md section 3.
 * No metric maths at all, just assembling what already exists across a couple of repositories, so
 * it gets its own tiny service rather than living in a controller (a controller never touches a
 * repository -- docs/architecture.md).
 */

import type { EngineerRepository } from "../repositories/engineers.ts"
import type { RunRepository } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"

export interface IdAndName {
  id: number
  name: string
}

export interface FilterOptions {
  teams: IdAndName[]
  agentKinds: string[]
  engineers: IdAndName[]
}

const EPOCH = new Date(0).toISOString()

export class LookupService {
  constructor(
    private readonly teams: TeamRepository,
    private readonly engineers: EngineerRepository,
    private readonly runs: RunRepository,
  ) {}

  /** `teamId` given: `engineers` is that team's own roster. Left out: `engineers` stays empty --
   *  see docs/api.md's note that an org-wide filter bar has no engineer picker at all. */
  getFilterOptions(orgId: number, teamId?: number): FilterOptions {
    return {
      teams: this.teams.listByOrgId(orgId).map((t) => ({ id: t.id, name: t.name })),
      agentKinds: this.distinctAgentKinds(orgId),
      engineers:
        teamId === undefined ? [] : this.engineers.listByTeamId(teamId).map((e) => ({ id: e.id, name: e.displayName })),
    }
  }

  listTeams(orgId: number): IdAndName[] {
    return this.teams.listByOrgId(orgId).map((t) => ({ id: t.id, name: t.name }))
  }

  /**
   * `RunRepository` has no "every distinct agent kind ever run" method -- `agent_kind` is
   * deliberately a free-form column with no fixed list (see packages/shared/src/enums.ts's
   * closing note on why there's no `agentKind` enum), so there is nothing to enumerate ahead of
   * time. `listStartedIn`'s own doc comment recommends exactly this for "the caller needs every
   * row, not a page of them" -- deduplicating client-side here is cheaper than adding a
   * `SELECT DISTINCT` method for what is, at this org's size, a handful of rows either way.
   */
  private distinctAgentKinds(orgId: number): string[] {
    const runs = this.runs.listStartedIn(orgId, { from: EPOCH, to: new Date().toISOString() })
    return [...new Set(runs.map((r) => r.agentKind))].sort()
  }
}
