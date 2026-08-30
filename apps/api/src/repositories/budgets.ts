import type { Database } from "bun:sqlite"
import type { Budget } from "@app/shared"

interface BudgetRow {
  id: number
  team_id: number
  month: string
  limit_cents: number
  warn_cents: number
  stop_cents: number
  updated_at: string
}

function rowToBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    teamId: row.team_id,
    month: row.month,
    limitCents: row.limit_cents,
    warnCents: row.warn_cents,
    stopCents: row.stop_cents,
    updatedAt: row.updated_at,
  }
}

export interface BudgetRepository {
  findById(id: number): Budget | undefined
  findByTeamAndMonth(teamId: number, month: string): Budget | undefined

  /** Every team's budget for a month, across the whole org -- what the org-wide `scope: "org"`
   *  view of `GET /api/budget-status` adds up. Budgets carry no org of their own, so this joins
   *  through the team. */
  listByOrgAndMonth(orgId: number, month: string): Budget[]

  /** Creates the budget if this team has none for that month yet, otherwise replaces it -- the
   *  one write in the whole API, per docs/api.md's `PUT /api/teams/:teamId/budget`. Whether the
   *  warn/stop/limit lines make sense together is checked before this is ever called; the
   *  database's own CHECK is the last line of defence, not the first. */
  upsert(input: Omit<Budget, "id">): Budget
}

export class SqliteBudgetRepository implements BudgetRepository {
  constructor(private readonly db: Database) {}

  findById(id: number): Budget | undefined {
    const row = this.db.query<BudgetRow, [number]>("SELECT * FROM budgets WHERE id = ?").get(id)
    return row ? rowToBudget(row) : undefined
  }

  findByTeamAndMonth(teamId: number, month: string): Budget | undefined {
    const row = this.db
      .query<BudgetRow, [number, string]>("SELECT * FROM budgets WHERE team_id = ? AND month = ?")
      .get(teamId, month)
    return row ? rowToBudget(row) : undefined
  }

  listByOrgAndMonth(orgId: number, month: string): Budget[] {
    return this.db
      .query<BudgetRow, [number, string]>(
        `SELECT budgets.* FROM budgets
         JOIN teams ON teams.id = budgets.team_id
         WHERE teams.org_id = ? AND budgets.month = ?
         ORDER BY budgets.team_id`,
      )
      .all(orgId, month)
      .map(rowToBudget)
  }

  upsert(input: Omit<Budget, "id">): Budget {
    const existing = this.findByTeamAndMonth(input.teamId, input.month)
    if (existing) {
      this.db
        .query(
          "UPDATE budgets SET limit_cents = ?, warn_cents = ?, stop_cents = ?, updated_at = ? WHERE id = ?",
        )
        .run(input.limitCents, input.warnCents, input.stopCents, input.updatedAt, existing.id)
    } else {
      this.db
        .query(
          `INSERT INTO budgets (team_id, month, limit_cents, warn_cents, stop_cents, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.teamId, input.month, input.limitCents, input.warnCents, input.stopCents, input.updatedAt)
    }
    return this.findByTeamAndMonth(input.teamId, input.month)!
  }
}
