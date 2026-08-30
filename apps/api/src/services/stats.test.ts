import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { median, percentile } from "./stats.ts"

/**
 * These tests do something slightly unusual on purpose: they run the SQL from
 * docs/data-model.md section 4 against the same numbers and check the TypeScript agrees.
 *
 * The SQL is the written definition of these numbers. The code is what actually runs. Without
 * a test tying them together, the doc slowly becomes a lie and nobody notices.
 */
function sqlMedian(values: number[]): number | null {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE v (c INTEGER)")
  const insert = db.query("INSERT INTO v (c) VALUES (?)")
  for (const v of values) insert.run(v)
  const row = db
    .query<{ m: number | null }, []>(
      `WITH ranked AS (
         SELECT c, ROW_NUMBER() OVER (ORDER BY c) AS rn, COUNT(*) OVER () AS n FROM v
       )
       SELECT (SELECT AVG(c) FROM ranked WHERE rn IN ((n + 1) / 2, (n + 2) / 2)) AS m`,
    )
    .get()
  db.close()
  return row?.m ?? null
}

function sqlPercentile(values: number[], share: number): number | null {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE v (c INTEGER)")
  const insert = db.query("INSERT INTO v (c) VALUES (?)")
  for (const v of values) insert.run(v)
  const row = db
    .query<{ p: number | null }, [number]>(
      `WITH ranked AS (SELECT c, CUME_DIST() OVER (ORDER BY c) AS position FROM v)
       SELECT MIN(c) AS p FROM ranked WHERE position >= ?`,
    )
    .get(share)
  db.close()
  return row?.p ?? null
}

const CASES: number[][] = [
  [5],
  [1, 2],
  [1, 2, 3],
  [1, 2, 3, 4],
  [3, 1, 4, 1, 5, 9, 2, 6],
  [1, 1, 1, 1, 2],
  [100, 100, 100, 100, 100, 100, 100, 100, 100, 10000], // the long tail this product actually has
  Array.from({ length: 97 }, (_, i) => (i * 37) % 101),
]

test("median agrees with the SQL definition it is documented as", () => {
  for (const values of CASES) {
    expect(median(values)).toBe(sqlMedian(values))
  }
})

test("percentiles agree with the SQL definition they are documented as", () => {
  for (const values of CASES) {
    for (const share of [0.5, 0.9, 0.95, 0.99]) {
      expect(percentile(values, share)).toBe(sqlPercentile(values, share))
    }
  }
})

test("the median is not dragged around by one runaway value, but the average is", () => {
  // Nine cheap tasks and one very expensive one — the shape docs/seed-data.md builds on purpose.
  const cents = [24, 24, 24, 24, 24, 24, 24, 24, 24, 82278]
  const average = cents.reduce((a, b) => a + b, 0) / cents.length
  expect(median(cents)).toBe(24)
  expect(Math.round(average)).toBe(8249)
  // This gap is why the median leads on every screen and the average sits beside it.
})

test("averaging percentiles across buckets gives the wrong answer", () => {
  // The trap docs/metrics.md warns about, made concrete.
  const monday = [10, 10, 10, 10, 10, 10, 10, 10, 10, 1000]
  const tuesday = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]

  // Monday's own p95 is 1000 (its one slow value is 10% of ten rows). Tuesday's is 20.
  const perDay = [percentile(monday, 0.95)!, percentile(tuesday, 0.95)!]
  const averagedWrongly = (perDay[0]! + perDay[1]!) / 2

  // Over the twenty rows together, 19 of them are 20 or under, so the real p95 is 20.
  const doneProperly = percentile([...monday, ...tuesday], 0.95)!

  expect(perDay).toEqual([1000, 20])
  expect(averagedWrongly).toBe(510)
  expect(doneProperly).toBe(20)

  // Averaging the two days overstates the tail by more than twenty times. It can miss in either
  // direction, which is the point: the error is not small and not predictable.
  expect(averagedWrongly / doneProperly).toBeGreaterThan(20)
})

test("no numbers means no answer, rather than zero", () => {
  // Zero would read on screen as "it took 0ms", which is a lie. Nothing means nothing.
  expect(median([])).toBeNull()
  expect(percentile([], 0.95)).toBeNull()
})
