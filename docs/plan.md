# Build plan

Seven steps. Each one names what gets built, who builds it, and the check that has to pass
before it counts as done. Steps in the same wave have no dependency on each other and run at
the same time.

Read `docs/architecture.md` before starting anything, and the doc named in each step.

---

## Wave A — the spine (everything waits on this)

### Step 1: Repo skeleton and shared types
**Build:** Bun workspace root, `apps/api`, `apps/web`, `packages/shared`. TypeScript config.
All the shared types and Zod schemas from `docs/api.md` and the enums from `docs/data-model.md`,
in `packages/shared`, imported by both sides.
**Read:** `docs/api.md`, `docs/data-model.md`
**Done when:** `bun install` works from a clean clone, `bun run typecheck` passes, and both apps
can import a type from `packages/shared`.

One agent. Nothing else can start until the shared shapes exist, because everything downstream
imports them.

---

## Wave B — three tracks at once

### Step 2: Database and repositories
**Build:** numbered migration files, a small migration runner, and one repository class per
table. All SQL lives here and nowhere else. The `runs_parent_must_be_first` trigger goes in the
migration, not in code.
**Read:** `docs/data-model.md`, `docs/architecture.md`
**Done when:** repository tests pass against a real temporary SQLite file built from the actual
migration files — never a hand-copied schema, so a broken migration cannot hide behind a green
suite. The trigger test proves a mis-linked retry is refused.

### Step 3: Seed data
**Build:** the generator described in `docs/seed-data.md`. Fixed seed 42.
**Read:** `docs/seed-data.md`, `docs/data-model.md`
**Done when:** `bun run seed` fills a fresh database, running it twice gives byte-identical
output, and a handful of spot checks hold: one team over its stop line, one just under its
warning line, dormant seats present, costs long-tailed enough that median and average visibly
differ.

### Step 4: Web shell
**Build:** Vite app, routing for the four screens, layout, the shared filter bar, the chart
components, loading and error states. Runs against hard-coded sample data shaped by the Zod
schemas from step 1 — no API needed yet.
**Read:** `docs/ui.md`, `artifacts/wireframes/`, `docs/api.md`
**Done when:** all four screens render from sample data and match the wireframes' layout.

---

## Wave C — the maths, and the real screens

### Step 5: Services
**Build:** one service per metric group — adoption, outcome, money, reliability, rules, speed.
Each takes repository interfaces through its constructor. This is where every definition in
`docs/metrics.md` actually gets implemented.
**Read:** `docs/metrics.md` (the whole thing), `docs/testing.md`
**Done when:** every test named in `docs/testing.md` section 2 passes, using fake repositories
and no database at all. This is the step that matters most — the definitions are the product.

Split across three agents by metric group. They share no state.

### Step 6: HTTP layer
**Build:** routes, controllers, the one error envelope, the budget write path with its
validation. Controllers stay thin: read the request, check it with Zod, call a service, shape
the reply.
**Read:** `docs/api.md`, `docs/architecture.md`
**Done when:** controller tests pass by sending real HTTP requests to a running server, and no
controller file contains SQL or a business rule. Budget validation rejects a warning line set
above the stop line.

---

## Wave D — joining it up

### Step 7: Wire the web app to the real API, then the acceptance pass
**Build:** swap the sample data for real calls. Then walk every scenario in `docs/testing.md`
section 3 by hand against the seeded database.

**Do this first — a loose end left on purpose.** Seven fields were widened into the contract while
the web screens were being built against their own stand-in types, so they are marked optional in
`packages/shared/src/api.ts` even though a real reply always sends them: `RunSummary.taskSummary`
and `.primaryOutputKind`, `TaskAttempt.failureCause` and `.blame`, `FlagListItem.teamId` and
`.teamName`, and `BudgetStatusResponse.dailySpend`. That was the honest way to widen a contract
that in-flight code was already reading. Once the screens read these fields from the real API,
**drop the `.optional()`** — otherwise every screen has to keep handling an absence that cannot
happen, forever.

> `ponytail:` seven fields optional to avoid breaking an in-flight build. Tighten them here.
**Build:** swap the sample data for real calls. Then walk every scenario in `docs/testing.md`
section 3 by hand against the seeded database.
**Done when:** all four screens work end to end on seeded data, every acceptance scenario
checks out, and the README says how to clone, seed, and run.

---

## Order in one picture

```
Wave A   [1 skeleton + shared types]
              |
Wave B   [2 db + repos] [3 seed] [4 web shell]
              |            |         |
Wave C   [5 services -------+        |
              |                      |
Wave D   [6 http] ------------------ [7 wire up + acceptance]
```

---

## Rules that hold for every step

- **The test comes with the code, not after it.** `docs/testing.md` already names the test for
  every number. A step is not done because the code exists.
- **No SQL outside a repository. No rules inside a controller.** If a step needs to break this,
  the step is wrong, not the rule.
- **A deliberate shortcut gets a `ponytail:` comment** naming its ceiling and the way out.
- **Plain words in code too** — names, comments, error messages. Same rule as the docs.
- **If a doc turns out wrong while building, fix the doc in the same change.** A spec nobody
  trusts is worse than no spec.

## Known risks

| Risk | What we do about it |
|---|---|
| The metric definitions are the hard part and they live in one big doc | Step 5 is split by group and every definition has a named test before code is written |
| Seeded data that looks fake makes every screen look fake | Step 3 has its own spot checks and lands before the screens do |
| Percentiles get "optimised" into an average by a later change | The test uses a fixture where averaging is visibly 10x wrong, so it fails loudly |
| Four screens is a lot of front-end for the time available | The web shell (step 4) runs in parallel with the whole back end, on sample data |
