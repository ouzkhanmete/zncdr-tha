import type { Database } from "bun:sqlite"
import type { ToolCall, ToolCallOutcome } from "@app/shared"

interface ToolCallRow {
  id: number
  run_id: number
  turn_id: number
  tool_name: string
  duration_ms: number
  outcome: string
  target: string | null
  error_type: string | null
  cost_cents: number
}

function rowToToolCall(row: ToolCallRow): ToolCall {
  return {
    id: row.id,
    runId: row.run_id,
    turnId: row.turn_id,
    toolName: row.tool_name,
    durationMs: row.duration_ms,
    outcome: row.outcome as ToolCallOutcome,
    target: row.target,
    errorType: row.error_type,
    costCents: row.cost_cents,
  }
}

export interface ToolCallRepository {
  create(input: Omit<ToolCall, "id">): ToolCall
  findById(id: number): ToolCall | undefined
  listByRunId(runId: number): ToolCall[]
  listByTurnId(turnId: number): ToolCall[]
}

export class SqliteToolCallRepository implements ToolCallRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<ToolCall, "id">): ToolCall {
    const result = this.db
      .query(
        `INSERT INTO tool_calls (run_id, turn_id, tool_name, duration_ms, outcome, target, error_type, cost_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.turnId,
        input.toolName,
        input.durationMs,
        input.outcome,
        input.target,
        input.errorType,
        input.costCents,
      )
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): ToolCall | undefined {
    const row = this.db.query<ToolCallRow, [number]>("SELECT * FROM tool_calls WHERE id = ?").get(id)
    return row ? rowToToolCall(row) : undefined
  }

  listByRunId(runId: number): ToolCall[] {
    return this.db
      .query<ToolCallRow, [number]>("SELECT * FROM tool_calls WHERE run_id = ? ORDER BY id")
      .all(runId)
      .map(rowToToolCall)
  }

  listByTurnId(turnId: number): ToolCall[] {
    return this.db
      .query<ToolCallRow, [number]>("SELECT * FROM tool_calls WHERE turn_id = ? ORDER BY id")
      .all(turnId)
      .map(rowToToolCall)
  }
}
