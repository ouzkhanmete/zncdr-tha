import type { Database } from "bun:sqlite"
import type { Org } from "@app/shared"

interface OrgRow {
  id: number
  name: string
  licensed_seats: number
  created_at: string
}

function rowToOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    licensedSeats: row.licensed_seats,
    createdAt: row.created_at,
  }
}

/** What a service is allowed to ask of the orgs table. Services depend on this, never on the
 *  class below, so a test can hand a service a fake org repository with no database at all. */
export interface OrgRepository {
  create(input: Omit<Org, "id">): Org
  findById(id: number): Org | undefined
  list(): Org[]
}

export class SqliteOrgRepository implements OrgRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Org, "id">): Org {
    const result = this.db
      .query("INSERT INTO orgs (name, licensed_seats, created_at) VALUES (?, ?, ?)")
      .run(input.name, input.licensedSeats, input.createdAt)
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Org | undefined {
    const row = this.db.query<OrgRow, [number]>("SELECT * FROM orgs WHERE id = ?").get(id)
    return row ? rowToOrg(row) : undefined
  }

  list(): Org[] {
    return this.db
      .query<OrgRow, []>("SELECT * FROM orgs ORDER BY id")
      .all()
      .map(rowToOrg)
  }
}
