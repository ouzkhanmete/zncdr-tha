import type { Database } from "bun:sqlite"
import type { Team } from "@app/shared"

interface TeamRow {
  id: number
  org_id: number
  name: string
  created_at: string
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    createdAt: row.created_at,
  }
}

export interface TeamRepository {
  create(input: Omit<Team, "id">): Team
  findById(id: number): Team | undefined
  listByOrgId(orgId: number): Team[]
}

export class SqliteTeamRepository implements TeamRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Team, "id">): Team {
    const result = this.db
      .query("INSERT INTO teams (org_id, name, created_at) VALUES (?, ?, ?)")
      .run(input.orgId, input.name, input.createdAt)
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Team | undefined {
    const row = this.db.query<TeamRow, [number]>("SELECT * FROM teams WHERE id = ?").get(id)
    return row ? rowToTeam(row) : undefined
  }

  listByOrgId(orgId: number): Team[] {
    return this.db
      .query<TeamRow, [number]>("SELECT * FROM teams WHERE org_id = ? ORDER BY id")
      .all(orgId)
      .map(rowToTeam)
  }
}
