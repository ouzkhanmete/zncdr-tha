import type { Database } from "bun:sqlite"
import type { Artifact, ArtifactKind } from "@app/shared"
import type { DateWindow, ScopeFilters } from "./types.ts"

interface ArtifactRow {
  id: number
  run_id: number
  kind: string
  ref: string
  created_at: string
  merged_at: string | null
  reverted_at: string | null
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind as ArtifactKind,
    ref: row.ref,
    createdAt: row.created_at,
    mergedAt: row.merged_at,
    revertedAt: row.reverted_at,
  }
}

export interface ArtifactRepository {
  create(input: Omit<Artifact, "id">): Artifact
  findById(id: number): Artifact | undefined
  listByRunId(runId: number): Artifact[]

  /** Every artifact created within the window, for an org -- answers "what came out" in
   *  docs/metrics.md: what was *produced*, split by kind, over this stretch of time. Not the
   *  question merged pull requests or rework rate ask -- those are about when a change *merged*,
   *  not when it was made; see `listMergedInWindow` for that. Artifacts carry no org of their
   *  own, so this joins through the run that produced them. */
  listCreatedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): Artifact[]

  /** Every artifact that *merged* within the window, for an org -- what merged pull requests and
   *  rework rate in docs/metrics.md are built from, both defined over merged changes rather than
   *  created ones. A pull request opened before the window but merged inside it counts here; one
   *  merged before the window does not, even though it may still have been created inside it.
   *  Never returns an artifact with no merge at all. Joins through the run the same way
   *  `listCreatedInWindow` does. */
  listMergedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): Artifact[]

  /** The earliest-created artifact's kind for each of the given runs, keyed by run id -- what a
   *  run list (`RunSummary.primaryOutputKind`, see docs/api.md section 7) uses to show one output
   *  icon per row without a follow-up call per row. Most successful runs produce exactly one
   *  artifact (see docs/seed-data.md); when a run produced more than one, "earliest created" is
   *  the tiebreak -- a deterministic pick, not a judgement about which kind of output matters
   *  most. A run with no artifacts has no entry in the map. */
  listPrimaryKindByRunIds(runIds: readonly number[]): Map<number, ArtifactKind>
}

/** Appends `AND runs.column = ?` for each scope filter present, and the bound values to match --
 *  shared by every query here that joins artifacts through their run to reach org/team scope. */
function scopeClause(filters: ScopeFilters | undefined) {
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
  return { clauses, params }
}

export class SqliteArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Artifact, "id">): Artifact {
    const result = this.db
      .query(
        `INSERT INTO artifacts (run_id, kind, ref, created_at, merged_at, reverted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.runId, input.kind, input.ref, input.createdAt, input.mergedAt, input.revertedAt)
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Artifact | undefined {
    const row = this.db.query<ArtifactRow, [number]>("SELECT * FROM artifacts WHERE id = ?").get(id)
    return row ? rowToArtifact(row) : undefined
  }

  listByRunId(runId: number): Artifact[] {
    return this.db
      .query<ArtifactRow, [number]>("SELECT * FROM artifacts WHERE run_id = ? ORDER BY id")
      .all(runId)
      .map(rowToArtifact)
  }

  listCreatedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): Artifact[] {
    const { clauses, params } = scopeClause(filters)
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""

    return this.db
      .query<ArtifactRow, [number, string, string, ...(number | string)[]]>(
        `SELECT artifacts.* FROM artifacts
         JOIN runs ON runs.id = artifacts.run_id
         WHERE runs.org_id = ?
           AND artifacts.created_at >= ? AND artifacts.created_at < ?
           ${extra}
         ORDER BY artifacts.created_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map(rowToArtifact)
  }

  listMergedInWindow(orgId: number, window: DateWindow, filters?: ScopeFilters): Artifact[] {
    const { clauses, params } = scopeClause(filters)
    const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""

    return this.db
      .query<ArtifactRow, [number, string, string, ...(number | string)[]]>(
        `SELECT artifacts.* FROM artifacts
         JOIN runs ON runs.id = artifacts.run_id
         WHERE runs.org_id = ?
           AND artifacts.merged_at IS NOT NULL
           AND artifacts.merged_at >= ? AND artifacts.merged_at < ?
           ${extra}
         ORDER BY artifacts.merged_at ASC`,
      )
      .all(orgId, window.from, window.to, ...params)
      .map(rowToArtifact)
  }

  listPrimaryKindByRunIds(runIds: readonly number[]): Map<number, ArtifactKind> {
    if (runIds.length === 0) return new Map()
    const placeholders = runIds.map(() => "?").join(", ")
    const rows = this.db
      .query<{ run_id: number; kind: string }, number[]>(
        `WITH ranked AS (
           SELECT run_id, kind,
                  ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY created_at ASC, id ASC) AS rn
           FROM artifacts
           WHERE run_id IN (${placeholders})
         )
         SELECT run_id, kind FROM ranked WHERE rn = 1`,
      )
      .all(...runIds)
    return new Map(rows.map((r) => [r.run_id, r.kind as ArtifactKind]))
  }
}
