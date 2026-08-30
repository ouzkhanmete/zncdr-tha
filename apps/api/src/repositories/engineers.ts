import type { Database } from "bun:sqlite"
import type { Engineer } from "@app/shared"

interface EngineerRow {
  id: number
  org_id: number
  team_id: number | null
  handle: string
  display_name: string
  seat_granted_at: string
  seat_active: number
}

function rowToEngineer(row: EngineerRow): Engineer {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    handle: row.handle,
    displayName: row.display_name,
    seatGrantedAt: row.seat_granted_at,
    seatActive: row.seat_active === 1,
  }
}

export interface EngineerRepository {
  create(input: Omit<Engineer, "id">): Engineer
  findById(id: number): Engineer | undefined
  findByHandle(orgId: number, handle: string): Engineer | undefined
  listByOrgId(orgId: number): Engineer[]
  listByTeamId(teamId: number): Engineer[]
  /** Moves a person onto a different team (or off any team, with `null`) as of right now. Runs
   *  they already made keep the team stamped on them at the time -- see runs.ts and
   *  docs/data-model.md's callout on why `runs.team_id` is never looked up through this column. */
  updateTeam(id: number, teamId: number | null): Engineer | undefined
}

export class SqliteEngineerRepository implements EngineerRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Engineer, "id">): Engineer {
    const result = this.db
      .query(
        `INSERT INTO engineers (org_id, team_id, handle, display_name, seat_granted_at, seat_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.orgId,
        input.teamId,
        input.handle,
        input.displayName,
        input.seatGrantedAt,
        input.seatActive ? 1 : 0,
      )
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Engineer | undefined {
    const row = this.db.query<EngineerRow, [number]>("SELECT * FROM engineers WHERE id = ?").get(id)
    return row ? rowToEngineer(row) : undefined
  }

  findByHandle(orgId: number, handle: string): Engineer | undefined {
    const row = this.db
      .query<EngineerRow, [number, string]>("SELECT * FROM engineers WHERE org_id = ? AND handle = ?")
      .get(orgId, handle)
    return row ? rowToEngineer(row) : undefined
  }

  listByOrgId(orgId: number): Engineer[] {
    return this.db
      .query<EngineerRow, [number]>("SELECT * FROM engineers WHERE org_id = ? ORDER BY id")
      .all(orgId)
      .map(rowToEngineer)
  }

  listByTeamId(teamId: number): Engineer[] {
    return this.db
      .query<EngineerRow, [number]>("SELECT * FROM engineers WHERE team_id = ? ORDER BY id")
      .all(teamId)
      .map(rowToEngineer)
  }

  updateTeam(id: number, teamId: number | null): Engineer | undefined {
    this.db.query("UPDATE engineers SET team_id = ? WHERE id = ?").run(teamId, id)
    return this.findById(id)
  }
}
