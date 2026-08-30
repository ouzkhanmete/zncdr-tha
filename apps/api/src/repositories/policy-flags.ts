import type { Database } from "bun:sqlite"
import type { Disposition, PolicyFlag, PolicyFlagKind, Severity } from "@app/shared"
import type { DateWindow, ScopeFilters } from "./types.ts"

interface PolicyFlagRow {
  id: number
  run_id: number
  turn_id: number | null
  kind: string
  severity: string
  disposition: string
  resource: string | null
  created_at: string
}

function rowToPolicyFlag(row: PolicyFlagRow): PolicyFlag {
  return {
    id: row.id,
    runId: row.run_id,
    turnId: row.turn_id,
    kind: row.kind as PolicyFlagKind,
    severity: row.severity as Severity,
    disposition: row.disposition as Disposition,
    resource: row.resource,
    createdAt: row.created_at,
  }
}

/** A flag plus which team its run belongs to -- what the org-wide `GET /api/flags` list needs to
 *  show a team column on every row, per docs/ui.md's org "Rules" table. */
export interface PolicyFlagWithTeam extends PolicyFlag {
  teamId: number
  teamName: string
}

export interface PolicyFlagRepository {
  create(input: Omit<PolicyFlag, "id">): PolicyFlag
  findById(id: number): PolicyFlag | undefined
  listByRunId(runId: number): PolicyFlag[]

  /** Every flag raised within the window, for an org -- flags carry no org of their own, so this
   *  joins through the run they were raised in. */
  listCreatedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): PolicyFlag[]

  /** Same as `listCreatedInWindow`, but each flag also carries the id and name of the team its
   *  run belongs to -- an extra join a caller that already scoped its own request to one team has
   *  no need for, so this is its own method rather than growing every caller's shape. */
  listCreatedInWindowWithTeam(
    orgId: number,
    window: DateWindow,
    filters?: ScopeFilters,
  ): PolicyFlagWithTeam[]

  /** How many times a team has already seen a flag of this kind, before a given moment. A count
   *  of zero is what "new for this team" in docs/metrics.md Group 5 means -- ranking on that is a
   *  service's job, this only counts. */
  countPriorByKindForTeam(teamId: number, kind: PolicyFlagKind, before: string): number
}

export class SqlitePolicyFlagRepository implements PolicyFlagRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<PolicyFlag, "id">): PolicyFlag {
    const result = this.db
      .query(
        `INSERT INTO policy_flags (run_id, turn_id, kind, severity, disposition, resource, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.turnId,
        input.kind,
        input.severity,
        input.disposition,
        input.resource,
        input.createdAt,
      )
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): PolicyFlag | undefined {
    const row = this.db
      .query<PolicyFlagRow, [number]>("SELECT * FROM policy_flags WHERE id = ?")
      .get(id)
    return row ? rowToPolicyFlag(row) : undefined
  }

  listByRunId(runId: number): PolicyFlag[] {
    return this.db
      .query<PolicyFlagRow, [number]>("SELECT * FROM policy_flags WHERE run_id = ? ORDER BY id")
      .all(runId)
      .map(rowToPolicyFlag)
  }

  listCreatedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): PolicyFlag[] {
    const clauses: string[] = []
    const params: (number | string)[] = []
    if (filters?.teamId !== undefined) {
      clauses.push("runs.team_id = ?")
      params.push(filters.teamId)
    }
    if (filters?.agentKind !== undefined) {
      clauses.push("runs.agent_kind = ?")
      params.push(filters.agentKind)
    }
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""

    return this.db
      .query<PolicyFlagRow, [number, string, string, ...(number | string)[]]>(
        `SELECT policy_flags.* FROM policy_flags
         JOIN runs ON runs.id = policy_flags.run_id
         WHERE runs.org_id = ?
           AND policy_flags.created_at >= ? AND policy_flags.created_at < ?
           ${extra}
         ORDER BY policy_flags.created_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map(rowToPolicyFlag)
  }

  listCreatedInWindowWithTeam(
    orgId: number,
    window: DateWindow,
    filters?: ScopeFilters,
  ): PolicyFlagWithTeam[] {
    const clauses: string[] = []
    const params: (number | string)[] = []
    if (filters?.teamId !== undefined) {
      clauses.push("runs.team_id = ?")
      params.push(filters.teamId)
    }
    if (filters?.agentKind !== undefined) {
      clauses.push("runs.agent_kind = ?")
      params.push(filters.agentKind)
    }
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""

    return this.db
      .query<
        PolicyFlagRow & { team_id: number; team_name: string },
        [number, string, string, ...(number | string)[]]
      >(
        `SELECT policy_flags.*, runs.team_id AS team_id, teams.name AS team_name
         FROM policy_flags
         JOIN runs ON runs.id = policy_flags.run_id
         JOIN teams ON teams.id = runs.team_id
         WHERE runs.org_id = ?
           AND policy_flags.created_at >= ? AND policy_flags.created_at < ?
           ${extra}
         ORDER BY policy_flags.created_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map((row) => ({ ...rowToPolicyFlag(row), teamId: row.team_id, teamName: row.team_name }))
  }

  countPriorByKindForTeam(teamId: number, kind: PolicyFlagKind, before: string): number {
    return this.db
      .query<{ count: number }, [number, string, string]>(
        `SELECT COUNT(*) AS count FROM policy_flags
         JOIN runs ON runs.id = policy_flags.run_id
         WHERE runs.team_id = ? AND policy_flags.kind = ? AND policy_flags.created_at < ?`,
      )
      .get(teamId, kind, before)!.count
  }
}
