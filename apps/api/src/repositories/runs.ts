import type { Database } from "bun:sqlite"
import type { Blame, Run, RunStatus } from "@app/shared"
import type { DateWindow, ScopeFilters } from "./types.ts"

interface RunRow {
  id: number
  org_id: number
  team_id: number
  engineer_id: number | null
  parent_run_id: number | null
  agent_kind: string
  trigger: string
  repo: string | null
  branch: string | null
  started_at: string
  actor_utc_offset_minutes: number
  finished_at: string | null
  status: string
  failure_cause: string | null
  blame: string | null
  is_quiet_failure: number
  duration_ms: number | null
  total_cost_cents: number
  turn_count: number
  tool_call_count: number
  task_summary: string
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    engineerId: row.engineer_id,
    parentRunId: row.parent_run_id,
    agentKind: row.agent_kind,
    trigger: row.trigger as Run["trigger"],
    repo: row.repo,
    branch: row.branch,
    startedAt: row.started_at,
    actorUtcOffsetMinutes: row.actor_utc_offset_minutes,
    finishedAt: row.finished_at,
    status: row.status as RunStatus,
    failureCause: row.failure_cause as Run["failureCause"],
    blame: row.blame as Blame | null,
    isQuietFailure: row.is_quiet_failure === 1,
    durationMs: row.duration_ms,
    totalCostCents: row.total_cost_cents,
    turnCount: row.turn_count,
    toolCallCount: row.tool_call_count,
    taskSummary: row.task_summary,
  }
}

/** Extra fields to filter a run search by, beyond org and window. Every field is optional and
 *  already resolved to the id the database uses -- turning a wire id into one of these is a
 *  service/controller job. */
export interface RunFilters extends ScopeFilters {
  engineerId?: number
  status?: RunStatus
  blame?: Blame
}

/** Every attempt in one task, collapsed by `COALESCE(parent_run_id, id)` -- see
 *  docs/data-model.md's "the chain, defined once". The median/average/worst-case math over these
 *  belongs to a service, not here; this hands back the raw per-task totals it needs. */
export interface FinishedTaskCost {
  taskId: number
  costCents: number
  attemptCount: number
  everSucceeded: boolean
}

/** Every finished attempt of one task, for tasks whose first attempt started in the window --
 *  the "in the end, did the person get what they needed" shape from docs/data-model.md section 4.
 *  Anchored on when the task started, not when each retry finished, so a chain spanning midnight
 *  keeps all its attempts together. */
export interface TaskOutcome {
  taskId: number
  runs: Run[]
}

export interface RunSearchResult {
  items: Run[]
  total: number
}

/** One UTC calendar day's worth of run cost, for a team or the whole org -- the building block a
 *  service turns into a running total for the budget screens' burn chart (see docs/api.md's
 *  `GET /api/budget-status` `dailySpend`). Not restricted to finished runs on purpose: budget
 *  spend counts money already run up by runs still in progress -- see docs/api.md section 10. */
export interface DailyCostTotal {
  date: string // "YYYY-MM-DD", the UTC day `started_at` falls on
  costCents: number
}

/** What a service is allowed to ask of the runs table. Every window is `from` inclusive, `to`
 *  exclusive, matching docs/metrics.md throughout. */
export interface RunRepository {
  create(input: Omit<Run, "id">): Run
  findById(id: number): Run | undefined

  /** Keeps `total_cost_cents` / `turn_count` / `tool_call_count` in step as turns and tool calls
   *  are written elsewhere -- see docs/data-model.md's note that these are cached, not the source
   *  of truth. Deciding *when* to call this is a service's job; this only ever writes what it's
   *  told. */
  updateRollups(
    id: number,
    totals: { totalCostCents: number; turnCount: number; toolCallCount: number },
  ): Run | undefined

  /** Every run in the chain a given run belongs to, first attempt first -- the first attempt
   *  itself plus every retry pointing at it. `taskId` is a first attempt's own id. */
  listChainMembers(taskId: number): Run[]

  /** Per-task cost totals for finished tasks in the window -- the `chain_costs` /
   *  `task_totals` shape from docs/data-model.md section 4, minus the median/average/worst-case
   *  math a service does over the result. */
  listFinishedTaskCosts(orgId: number, window: DateWindow, filters?: RunFilters): FinishedTaskCost[]

  /** Runs that reached an end within the window -- `finished_at IS NOT NULL`, so a run still
   *  going never pollutes a finished-run number. Includes every terminal status, cancelled and
   *  timed-out runs included; a service decides which statuses belong in which number. */
  listEndedRuns(orgId: number, window: DateWindow, filters?: RunFilters): Run[]

  /** Finished attempts, grouped by task, for every task whose first attempt started in the
   *  window -- the "anchors" / "chain_members" shape from docs/data-model.md section 4. */
  listTaskOutcomesStartedIn(orgId: number, window: DateWindow, filters?: RunFilters): TaskOutcome[]

  /** Runs with no end yet (`finished_at IS NULL`) -- the live "in progress" count and its cost
   *  so far. */
  listRunning(orgId: number, filters?: ScopeFilters): Run[]

  /** A paged search over runs started in the window, for the drill-down tables in
   *  `GET /api/runs` and `GET /api/engineers/:id/runs`. Not restricted to finished runs. */
  search(
    orgId: number,
    window: DateWindow,
    filters: RunFilters & { limit: number; offset: number },
  ): RunSearchResult

  /** Every run whose own `started_at` falls in the window, unpaged -- what adoption counts
   *  distinct engineers from ("started at least one run in the window", docs/metrics.md's
   *  "Adoption rate"). Same shape as `search`, minus the paging: a full scan is the right tool
   *  here because the caller needs every row, not a page of them. Not restricted to finished
   *  runs, matching `search`. */
  listStartedIn(orgId: number, window: DateWindow, filters?: RunFilters): Run[]

  /** Distinct engineer ids behind every run this org has ever started, no window at all --
   *  the bottom of sticking rate, "engineers who have ever run anything" (docs/metrics.md).
   *  Returns just the ids, since that's all sticking rate needs and it's far cheaper than
   *  handing back every run ever started. */
  everStartedEngineerIds(orgId: number, filters?: RunFilters): number[]

  /** Every run's cost in the window, summed by the UTC calendar day it *started* on -- grouping
   *  by day is the one part of the budget burn chart SQL is genuinely better at (same reasoning
   *  as `listFinishedTaskCosts` grouping by task); turning day totals into a running, cumulative
   *  total and finding "today" is a service's job. Leave `filters.teamId` out for the whole org's
   *  daily spend. */
  listDailyCostTotals(orgId: number, window: DateWindow, filters?: ScopeFilters): DailyCostTotal[]
}

/** Appends `AND column = ?` to a WHERE clause when the filter is present, and returns the bound
 *  value to go with it. Kept tiny and local -- this is string building around fixed column
 *  names only, never around a value that ends up inside the SQL text itself. */
function scopeClause(filters: RunFilters | ScopeFilters | undefined, table: string) {
  const clauses: string[] = []
  const params: (number | string)[] = []
  if (filters?.teamId !== undefined) {
    clauses.push(`${table}.team_id = ?`)
    params.push(filters.teamId)
  }
  if (filters?.agentKind !== undefined) {
    clauses.push(`${table}.agent_kind = ?`)
    params.push(filters.agentKind)
  }
  if (filters && "engineerId" in filters && filters.engineerId !== undefined) {
    clauses.push(`${table}.engineer_id = ?`)
    params.push(filters.engineerId)
  }
  if (filters && "status" in filters && filters.status !== undefined) {
    clauses.push(`${table}.status = ?`)
    params.push(filters.status)
  }
  if (filters && "blame" in filters && filters.blame !== undefined) {
    clauses.push(`${table}.blame = ?`)
    params.push(filters.blame)
  }
  return { clauses, params }
}

export class SqliteRunRepository implements RunRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Run, "id">): Run {
    const result = this.db
      .query(
        `INSERT INTO runs (
           org_id, team_id, engineer_id, parent_run_id, agent_kind, "trigger", repo, branch,
           started_at, actor_utc_offset_minutes, finished_at, status, failure_cause, blame,
           is_quiet_failure, duration_ms, total_cost_cents, turn_count, tool_call_count,
           task_summary
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.orgId,
        input.teamId,
        input.engineerId,
        input.parentRunId,
        input.agentKind,
        input.trigger,
        input.repo,
        input.branch,
        input.startedAt,
        input.actorUtcOffsetMinutes,
        input.finishedAt,
        input.status,
        input.failureCause,
        input.blame,
        input.isQuietFailure ? 1 : 0,
        input.durationMs,
        input.totalCostCents,
        input.turnCount,
        input.toolCallCount,
        input.taskSummary,
      )
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Run | undefined {
    const row = this.db.query<RunRow, [number]>("SELECT * FROM runs WHERE id = ?").get(id)
    return row ? rowToRun(row) : undefined
  }

  updateRollups(
    id: number,
    totals: { totalCostCents: number; turnCount: number; toolCallCount: number },
  ): Run | undefined {
    this.db
      .query("UPDATE runs SET total_cost_cents = ?, turn_count = ?, tool_call_count = ? WHERE id = ?")
      .run(totals.totalCostCents, totals.turnCount, totals.toolCallCount, id)
    return this.findById(id)
  }

  listChainMembers(taskId: number): Run[] {
    return this.db
      .query<RunRow, [number, number]>(
        "SELECT * FROM runs WHERE id = ? OR parent_run_id = ? ORDER BY started_at ASC",
      )
      .all(taskId, taskId)
      .map(rowToRun)
  }

  listFinishedTaskCosts(orgId: number, window: DateWindow, filters?: RunFilters): FinishedTaskCost[] {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    const rows = this.db
      .query<
        { task_id: number; cost_cents: number; attempt_count: number; ever_succeeded: number },
        [number, string, string, ...(number | string)[]]
      >(
        `SELECT
           COALESCE(parent_run_id, id) AS task_id,
           SUM(total_cost_cents)       AS cost_cents,
           COUNT(*)                    AS attempt_count,
           MAX(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS ever_succeeded
         FROM runs
         WHERE org_id = ?
           AND finished_at IS NOT NULL
           AND finished_at >= ? AND finished_at < ?
           ${extra}
         GROUP BY task_id`,
      )
      .all(orgId, window.from, window.to, ...params)
    return rows.map((r) => ({
      taskId: r.task_id,
      costCents: r.cost_cents,
      attemptCount: r.attempt_count,
      everSucceeded: r.ever_succeeded === 1,
    }))
  }

  listEndedRuns(orgId: number, window: DateWindow, filters?: RunFilters): Run[] {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    return this.db
      .query<RunRow, [number, string, string, ...(number | string)[]]>(
        `SELECT * FROM runs
         WHERE org_id = ?
           AND finished_at IS NOT NULL
           AND finished_at >= ? AND finished_at < ?
           ${extra}
         ORDER BY finished_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map(rowToRun)
  }

  listTaskOutcomesStartedIn(orgId: number, window: DateWindow, filters?: RunFilters): TaskOutcome[] {
    // The filter clause lands inside the `anchors` CTE's own body below, where the table being
    // filtered is still plain `runs` -- the alias `anchors` only exists for the outer query to
    // reference *after* the CTE is fully defined, not inside its own SELECT. Building the clause
    // against "anchors" here produced "no such column: anchors.<column>" the moment any caller
    // passed a real filter (teamId, agentKind, engineerId, status, or blame); nothing caught it
    // until services/engineer.ts started calling this with `engineerId` always set.
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    const rows = this.db
      .query<RunRow & { chain_task_id: number }, [number, string, string, ...(number | string)[]]>(
        `WITH anchors AS (
           SELECT * FROM runs
           WHERE org_id = ?
             AND parent_run_id IS NULL
             AND started_at >= ? AND started_at < ?
             ${extra}
         )
         SELECT r.*, anchors.id AS chain_task_id
         FROM runs r
         JOIN anchors ON (r.id = anchors.id OR r.parent_run_id = anchors.id)
         WHERE r.finished_at IS NOT NULL
         ORDER BY anchors.id, r.started_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)

    const byTask = new Map<number, Run[]>()
    for (const row of rows) {
      const runs = byTask.get(row.chain_task_id) ?? []
      runs.push(rowToRun(row))
      byTask.set(row.chain_task_id, runs)
    }
    return [...byTask.entries()].map(([taskId, runs]) => ({ taskId, runs }))
  }

  listRunning(orgId: number, filters?: ScopeFilters): Run[] {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    return this.db
      .query<RunRow, [number, ...(number | string)[]]>(
        `SELECT * FROM runs WHERE org_id = ? AND finished_at IS NULL ${extra} ORDER BY started_at ASC`,
      )
      .all(orgId, ...params)
      .map(rowToRun)
  }

  search(
    orgId: number,
    window: DateWindow,
    filters: RunFilters & { limit: number; offset: number },
  ): RunSearchResult {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""

    const total = this.db
      .query<{ count: number }, [number, string, string, ...(number | string)[]]>(
        `SELECT COUNT(*) AS count FROM runs
         WHERE org_id = ? AND started_at >= ? AND started_at < ? ${extra}`,
      )
      .get(orgId, window.from, window.to, ...params)!.count

    const items = this.db
      .query<RunRow, [number, string, string, ...(number | string)[], number, number]>(
        `SELECT * FROM runs
         WHERE org_id = ? AND started_at >= ? AND started_at < ? ${extra}
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(orgId, window.from, window.to, ...params, filters.limit, filters.offset)
      .map(rowToRun)

    return { items, total }
  }

  listStartedIn(orgId: number, window: DateWindow, filters?: RunFilters): Run[] {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    return this.db
      .query<RunRow, [number, string, string, ...(number | string)[]]>(
        `SELECT * FROM runs
         WHERE org_id = ?
           AND started_at >= ? AND started_at < ?
           ${extra}
         ORDER BY started_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map(rowToRun)
  }

  everStartedEngineerIds(orgId: number, filters?: RunFilters): number[] {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    return this.db
      .query<{ engineer_id: number }, [number, ...(number | string)[]]>(
        `SELECT DISTINCT engineer_id FROM runs
         WHERE org_id = ? AND engineer_id IS NOT NULL ${extra}`,
      )
      .all(orgId, ...params)
      .map((r) => r.engineer_id)
  }

  listDailyCostTotals(orgId: number, window: DateWindow, filters?: ScopeFilters): DailyCostTotal[] {
    const { clauses, params } = scopeClause(filters, "runs")
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
    // substr(started_at, 1, 10) reads off the "YYYY-MM-DD" day straight from the ISO UTC text --
    // safe because docs/data-model.md stores every timestamp exactly that way, the same trick
    // that lets timestamps sort correctly as plain strings.
    return this.db
      .query<{ date: string; cost_cents: number }, [number, string, string, ...(number | string)[]]>(
        `SELECT substr(started_at, 1, 10) AS date, SUM(total_cost_cents) AS cost_cents
         FROM runs
         WHERE org_id = ?
           AND started_at >= ? AND started_at < ?
           ${extra}
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map((r) => ({ date: r.date, costCents: r.cost_cents }))
  }
}
