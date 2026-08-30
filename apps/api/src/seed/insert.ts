import type { Database } from "bun:sqlite"
import type { SeedDataset } from "./generate/index.ts"

// Children before parents, so deleting one table never trips a foreign key still pointing at a
// row in a table deleted earlier.
const TABLES_IN_DELETE_ORDER = [
  "policy_flags",
  "tool_calls",
  "artifacts",
  "turns",
  "runs",
  "budgets",
  "engineers",
  "models",
  "teams",
  "orgs",
]

/**
 * Empties every table and resets SQLite's autoincrement counters back to zero, so a fresh run of
 * the seed hands out ids starting at 1 again. The generator assigns ids itself, in the exact
 * order rows are inserted below (see generate/org.ts and generate/runs.ts) -- that only lines up
 * with what SQLite actually stores if every counter starts from scratch first.
 */
function wipeTables(db: Database): void {
  const hasSequenceTable =
    db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get() !==
    null

  for (const table of TABLES_IN_DELETE_ORDER) {
    db.exec(`DELETE FROM ${table}`)
    if (hasSequenceTable) db.query("DELETE FROM sqlite_sequence WHERE name = ?").run(table)
  }
}

const bit = (value: boolean): number => (value ? 1 : 0)

/**
 * Wipes the database and inserts the whole generated dataset, table by table, parents before
 * children, all inside one transaction.
 *
 * ponytail: this writes raw SQL instead of going through a repository class, the one deliberate
 * exception to the "no SQL outside a repository" house rule (see CLAUDE.md and docs/plan.md).
 * The seed is a one-shot bulk loader, not application code that needs to be swappable to
 * Postgres behind an interface -- and inserting on the order of 200,000 rows one repository call
 * at a time, each paying a service's validation, would turn a two-second script into a slow one
 * for no benefit anything downstream relies on. Every value still matches the exact shape and
 * constraints in docs/data-model.md; only the path to the database is shorter.
 */
export function loadSeedData(db: Database, data: SeedDataset): void {
  db.transaction(() => {
    wipeTables(db)

    db.query("INSERT INTO orgs (id, name, licensed_seats, created_at) VALUES (?, ?, ?, ?)").run(
      data.org.id,
      data.org.name,
      data.org.licensedSeats,
      data.org.createdAt,
    )

    const insertTeam = db.query("INSERT INTO teams (id, org_id, name, created_at) VALUES (?, ?, ?, ?)")
    for (const t of data.teams) insertTeam.run(t.id, t.orgId, t.name, t.createdAt)

    const insertEngineer = db.query(
      `INSERT INTO engineers (id, org_id, team_id, handle, display_name, seat_granted_at, seat_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const e of data.engineers) {
      insertEngineer.run(e.id, e.orgId, e.teamId, e.handle, e.displayName, e.seatGrantedAt, bit(e.seatActive))
    }

    const insertModel = db.query(
      `INSERT INTO models (id, provider, name, input_price_per_mtok_cents, cached_input_price_per_mtok_cents,
                            cache_write_price_per_mtok_cents, output_price_per_mtok_cents, effective_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const m of data.models) {
      insertModel.run(
        m.id,
        m.provider,
        m.name,
        m.inputPricePerMtokCents,
        m.cachedInputPricePerMtokCents,
        m.cacheWritePricePerMtokCents,
        m.outputPricePerMtokCents,
        m.effectiveFrom,
      )
    }

    const insertRun = db.query(
      `INSERT INTO runs (id, org_id, team_id, engineer_id, parent_run_id, agent_kind, "trigger", repo, branch,
                          started_at, actor_utc_offset_minutes, finished_at, status, failure_cause, blame,
                          is_quiet_failure, duration_ms, total_cost_cents, turn_count, tool_call_count,
                          task_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const r of data.runs) {
      insertRun.run(
        r.id,
        r.orgId,
        r.teamId,
        r.engineerId,
        r.parentRunId,
        r.agentKind,
        r.trigger,
        r.repo,
        r.branch,
        r.startedAt,
        r.actorUtcOffsetMinutes,
        r.finishedAt,
        r.status,
        r.failureCause,
        r.blame,
        bit(r.isQuietFailure),
        r.durationMs,
        r.totalCostCents,
        r.turnCount,
        r.toolCallCount,
        r.taskSummary,
      )
    }

    const insertTurn = db.query(
      `INSERT INTO turns (id, run_id, turn_index, model_id, tokens_in_fresh, tokens_in_cached, tokens_cache_write,
                           tokens_out, tokens_thinking, latency_ms, finish_reason, cost_cents, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const t of data.turns) {
      insertTurn.run(
        t.id,
        t.runId,
        t.turnIndex,
        t.modelId,
        t.tokensInFresh,
        t.tokensInCached,
        t.tokensCacheWrite,
        t.tokensOut,
        t.tokensThinking,
        t.latencyMs,
        t.finishReason,
        t.costCents,
        t.startedAt,
      )
    }

    const insertToolCall = db.query(
      `INSERT INTO tool_calls (id, run_id, turn_id, tool_name, duration_ms, outcome, target, error_type, cost_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const c of data.toolCalls) {
      insertToolCall.run(c.id, c.runId, c.turnId, c.toolName, c.durationMs, c.outcome, c.target, c.errorType, c.costCents)
    }

    const insertArtifact = db.query(
      `INSERT INTO artifacts (id, run_id, kind, ref, created_at, merged_at, reverted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const a of data.artifacts) {
      insertArtifact.run(a.id, a.runId, a.kind, a.ref, a.createdAt, a.mergedAt, a.revertedAt)
    }

    const insertFlag = db.query(
      `INSERT INTO policy_flags (id, run_id, turn_id, kind, severity, disposition, resource, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const f of data.policyFlags) {
      insertFlag.run(f.id, f.runId, f.turnId, f.kind, f.severity, f.disposition, f.resource, f.createdAt)
    }

    const insertBudget = db.query(
      `INSERT INTO budgets (id, team_id, month, limit_cents, warn_cents, stop_cents, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const b of data.budgets) {
      insertBudget.run(b.id, b.teamId, b.month, b.limitCents, b.warnCents, b.stopCents, b.updatedAt)
    }
  })()
}
