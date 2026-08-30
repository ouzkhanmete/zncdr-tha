# CLAUDE.md

Analytics dashboard for an imaginary product where engineers run coding agents in the cloud.
It shows an org how those agents are doing: what they finished, who uses them, what they cost,
how often they break, and when they step out of line.

## House rules

1. **Plain words only.** No industry jargon, no buzzwords, no filler. If a short common word
   works, use it. Write for someone who has never read a consulting deck.
2. **One job per layer.** A file does one thing. See "Layers" below.
3. **Point one way.** Outer layers know about inner ones, never the reverse. Pass what a class
   needs through its constructor.
4. **Talk to shapes, not to things.** Depend on an interface/type, not on a concrete class.
5. **Write it down.** Anything worth knowing twice goes into `docs/` as a `.md` file.
6. **Proof goes in `artifacts/`.** Wireframes, prototypes, screenshots, research notes.
7. **Smallest thing that works.** No abstraction until a second caller exists.

## Stack

- Bun workspaces monorepo, TypeScript everywhere.
- `apps/web` - the dashboard people look at.
- `apps/api` - the HTTP service that feeds it.
- `packages/shared` - types, Zod schemas, small helpers used by both.
- SQLite for storage, but **written as if it were Postgres**: all reads and writes go through
  repository classes, schema changes go through numbered migration files. Swapping the driver
  later should be the only real work.
- Zod validates every request and response body at the edge.
- No login, no permissions. One reviewer looks at this at a time.

## Layers

| Layer | Lives in | Only allowed to do |
|---|---|---|
| Controller | `apps/api/src/http` | Read the request, check it with Zod, call a service, shape the reply |
| Service | `apps/api/src/services` | The actual thinking: rules, maths, calling other systems |
| Repository | `apps/api/src/repositories` | Talk to the database. Nothing else. No business rules. |
| Migration | `apps/api/migrations` | Numbered `.sql` files, forward only |
| Seed | `apps/api/src/seed` | Fill the database with believable fake data |

A controller never touches a repository. A repository never knows a controller exists.

## Docs index

Read the file that matches what you are about to touch.

| Working on | Read first |
|---|---|
| What we are building and why | `docs/product-brief.md` |
| Which numbers we show and exactly how each is worked out | `docs/metrics.md` |
| Tables, columns, keys, how rows roll up | `docs/data-model.md` |
| Endpoints, query params, request/response shapes, errors | `docs/api.md` |
| Folder layout, layer rules, how pieces get wired together | `docs/architecture.md` |
| Screens, what each one answers, how a user moves between them | `docs/ui.md` |
| Making the fake data look real | `docs/seed-data.md` |
| How we test and what "done" means | `docs/testing.md` |
| Choices we made and what we gave up | `docs/decisions.md` |
| What to build next, in what order | `docs/plan.md` |

## Where tests live

| Kind | What it tests | Where it goes |
|---|---|---|
| Unit | Business logic, with fake dependencies handed in through the constructor. No database. | `thing.test.ts` right beside `thing.ts` |
| Integration | The data layer for real — repositories against a real temporary SQLite file built from the real migration files | `thing.test.ts` right beside `thing.ts` |
| End to end | A whole path through the running app: real HTTP requests, or a screen driven for real | `apps/<app>/test/` |

**A test file sits beside the one file it covers and is named after it.** One test file covering
four source files means nobody can tell what is tested and what is not.

**The one exception:** `apps/api/src/db/schema.test.ts` covers `migrations/*.sql`, which has no
`.ts` file to sit beside. It lives with `migrate.ts`, the code that builds that schema, and its
first line says what it covers. Putting TypeScript inside the folder of SQL files would be worse.

Services get fake repositories, never a database — that is the whole reason a service takes an
interface through its constructor. Repositories get a real database, because a repository whose
SQL is faked is testing nothing.

## Working style

- Prefer a team of subagents over doing everything in one thread. Split by area, run them at once.
- Every non-trivial bit of logic leaves one runnable check behind.
- Mark a deliberate shortcut with a `ponytail:` comment naming the ceiling and the way out.
