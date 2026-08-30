import type { Database } from "bun:sqlite"
import type { Model } from "@app/shared"

interface ModelRow {
  id: number
  provider: string
  name: string
  input_price_per_mtok_cents: number
  cached_input_price_per_mtok_cents: number
  cache_write_price_per_mtok_cents: number
  output_price_per_mtok_cents: number
  effective_from: string
}

function rowToModel(row: ModelRow): Model {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    inputPricePerMtokCents: row.input_price_per_mtok_cents,
    cachedInputPricePerMtokCents: row.cached_input_price_per_mtok_cents,
    cacheWritePricePerMtokCents: row.cache_write_price_per_mtok_cents,
    outputPricePerMtokCents: row.output_price_per_mtok_cents,
    effectiveFrom: row.effective_from,
  }
}

export interface ModelRepository {
  create(input: Omit<Model, "id">): Model
  findById(id: number): Model | undefined
  /** The price row in effect at a given moment for a provider + model name -- the row whose
   *  `effectiveFrom` is the latest one at or before `at`. This is how a turn gets priced at the
   *  rate that was true when it ran, per docs/data-model.md's models table. */
  findEffectiveAt(provider: string, name: string, at: string): Model | undefined
  listAll(): Model[]
}

export class SqliteModelRepository implements ModelRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Model, "id">): Model {
    const result = this.db
      .query(
        `INSERT INTO models (provider, name, input_price_per_mtok_cents, cached_input_price_per_mtok_cents,
                              cache_write_price_per_mtok_cents, output_price_per_mtok_cents, effective_from)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.provider,
        input.name,
        input.inputPricePerMtokCents,
        input.cachedInputPricePerMtokCents,
        input.cacheWritePricePerMtokCents,
        input.outputPricePerMtokCents,
        input.effectiveFrom,
      )
    return this.findById(Number(result.lastInsertRowid))!
  }

  findById(id: number): Model | undefined {
    const row = this.db.query<ModelRow, [number]>("SELECT * FROM models WHERE id = ?").get(id)
    return row ? rowToModel(row) : undefined
  }

  findEffectiveAt(provider: string, name: string, at: string): Model | undefined {
    const row = this.db
      .query<ModelRow, [string, string, string]>(
        `SELECT * FROM models
         WHERE provider = ? AND name = ? AND effective_from <= ?
         ORDER BY effective_from DESC
         LIMIT 1`,
      )
      .get(provider, name, at)
    return row ? rowToModel(row) : undefined
  }

  listAll(): Model[] {
    return this.db
      .query<ModelRow, []>("SELECT * FROM models ORDER BY provider, name, effective_from")
      .all()
      .map(rowToModel)
  }
}
