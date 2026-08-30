import { expect, test } from "bun:test"
import { SqliteModelRepository } from "./models.ts"
import { freshDb } from "./test-helpers.ts"

test("writing a model and reading it back keeps every price an exact integer", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteModelRepository(db)
    const created = repo.create({
      provider: "anthropic",
      name: "opus",
      inputPricePerMtokCents: 1500,
      cachedInputPricePerMtokCents: 150,
      cacheWritePricePerMtokCents: 1875,
      outputPricePerMtokCents: 7500,
      effectiveFrom: "2026-01-01T00:00:00Z",
    })

    for (const field of [
      created.inputPricePerMtokCents,
      created.cachedInputPricePerMtokCents,
      created.cacheWritePricePerMtokCents,
      created.outputPricePerMtokCents,
    ]) {
      expect(Number.isInteger(field)).toBe(true)
    }
    expect(repo.findById(created.id)).toEqual(created)
  } finally {
    cleanup()
  }
})

test("reading a model that does not exist returns nothing, not a throw", () => {
  const { db, cleanup } = freshDb()
  try {
    expect(new SqliteModelRepository(db).findById(999)).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("findEffectiveAt picks the price row in effect at a given moment, not the newest one", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteModelRepository(db)
    const jan = repo.create({
      provider: "anthropic",
      name: "opus",
      inputPricePerMtokCents: 1500,
      cachedInputPricePerMtokCents: 150,
      cacheWritePricePerMtokCents: 1875,
      outputPricePerMtokCents: 7500,
      effectiveFrom: "2026-01-01T00:00:00Z",
    })
    const march = repo.create({
      provider: "anthropic",
      name: "opus",
      inputPricePerMtokCents: 1000,
      cachedInputPricePerMtokCents: 100,
      cacheWritePricePerMtokCents: 1250,
      outputPricePerMtokCents: 5000,
      effectiveFrom: "2026-03-01T00:00:00Z",
    })

    // A turn that ran in February is priced at January's rate -- the March price didn't exist yet.
    expect(repo.findEffectiveAt("anthropic", "opus", "2026-02-01T00:00:00Z")).toEqual(jan)
    // A turn that ran after March 1st gets the new rate.
    expect(repo.findEffectiveAt("anthropic", "opus", "2026-03-15T00:00:00Z")).toEqual(march)
    // Before any price existed at all, there is nothing to charge.
    expect(repo.findEffectiveAt("anthropic", "opus", "2025-12-31T00:00:00Z")).toBeUndefined()
  } finally {
    cleanup()
  }
})

test("a later price change never rewrites an old turn's rate", () => {
  const { db, cleanup } = freshDb()
  try {
    const repo = new SqliteModelRepository(db)
    const jan = repo.create({
      provider: "anthropic",
      name: "opus",
      inputPricePerMtokCents: 1500,
      cachedInputPricePerMtokCents: 150,
      cacheWritePricePerMtokCents: 1875,
      outputPricePerMtokCents: 7500,
      effectiveFrom: "2026-01-01T00:00:00Z",
    })
    const before = repo.findById(jan.id)
    repo.create({
      provider: "anthropic",
      name: "opus",
      inputPricePerMtokCents: 1,
      cachedInputPricePerMtokCents: 1,
      cacheWritePricePerMtokCents: 1,
      outputPricePerMtokCents: 1,
      effectiveFrom: "2026-06-01T00:00:00Z",
    })
    expect(repo.findById(jan.id)).toEqual(before)
  } finally {
    cleanup()
  }
})
