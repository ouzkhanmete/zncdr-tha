import type { Database } from "bun:sqlite"
import type { Turn, TurnFinishReason } from "@app/shared"
import type { DateWindow, ScopeFilters } from "./types.ts"

interface TurnRow {
  id: number
  run_id: number
  turn_index: number
  model_id: number
  tokens_in_fresh: number
  tokens_in_cached: number
  tokens_cache_write: number
  tokens_out: number
  tokens_thinking: number
  latency_ms: number
  finish_reason: string
  cost_cents: number
  started_at: string
}

function rowToTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    runId: row.run_id,
    turnIndex: row.turn_index,
    modelId: row.model_id,
    tokensInFresh: row.tokens_in_fresh,
    tokensInCached: row.tokens_in_cached,
    tokensCacheWrite: row.tokens_cache_write,
    tokensOut: row.tokens_out,
    tokensThinking: row.tokens_thinking,
    latencyMs: row.latency_ms,
    finishReason: row.finish_reason as TurnFinishReason,
    costCents: row.cost_cents,
    startedAt: row.started_at,
  }
}

export interface TurnRepository {
  create(input: Omit<Turn, "id">): Turn
  findById(id: number): Turn | undefined
  listByRunId(runId: number): Turn[]

  /** Every turn that started within the window, for an org -- the raw material for turn-time
   *  p50/p95/p99 in docs/metrics.md. Turns carry no org of their own, so this joins through the
   *  run that made them. */
  listStartedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): Turn[]
}

export class SqliteTurnRepository implements TurnRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Turn, "id">): Turn {
    const result = this.db
      .query(
        `INSERT INTO turns (
           run_id, turn_index, model_id, tokens_in_fresh, tokens_in_cached, tokens_cache_write,
           tokens_out, tokens_thinking, latency_ms, finish_reason, cost_cents, started_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.turnIndex,
        input.modelId,
        input.tokensInFresh,
        input.tokensInCached,
        input.tokensCacheWrite,
        input.tokensOut,
        input.tokensThinking,
        input.latencyMs,
        input.finishReason,
        input.costCents,
        input.startedAt,
      )
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Turn | undefined {
    const row = this.db.query<TurnRow, [number]>("SELECT * FROM turns WHERE id = ?").get(id)
    return row ? rowToTurn(row) : undefined
  }

  listByRunId(runId: number): Turn[] {
    return this.db
      .query<TurnRow, [number]>("SELECT * FROM turns WHERE run_id = ? ORDER BY turn_index ASC")
      .all(runId)
      .map(rowToTurn)
  }

  listStartedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): Turn[] {
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
      .query<TurnRow, [number, string, string, ...(number | string)[]]>(
        `SELECT turns.* FROM turns
         JOIN runs ON runs.id = turns.run_id
         WHERE runs.org_id = ?
           AND turns.started_at >= ? AND turns.started_at < ?
           ${extra}
         ORDER BY turns.started_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map(rowToTurn)
  }
}
