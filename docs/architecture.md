# Architecture

## What this is

One Bun workspace holding a web app, an HTTP service, and a shared package of types.
The web app draws charts. The service answers questions about agent runs. Nothing else.

## Folders

```
apps/
  web/                 React + Vite single-page app
    src/pages/         one file per screen
    src/components/    charts, tables, small pieces
    src/api/           thin typed fetch wrappers, one per endpoint group
  api/                 Bun HTTP service
    src/http/          routes and controllers
    src/services/      the thinking
    src/repositories/  the only code that writes SQL
    src/db/            connection, migration runner
    src/seed/          fake data generator
    migrations/        0001_*.sql, 0002_*.sql ... forward only
packages/
  shared/              types and Zod schemas used by web and api
docs/                  these files
artifacts/             research notes, wireframes, screenshots
```

## The one direction rule

```
HTTP request
   -> controller      reads the request, checks it with Zod, nothing else
      -> service      works out the answer, owns every rule
         -> repository   runs SQL, returns plain rows
            -> SQLite
```

Arrows never point back. A repository does not know a controller exists. A service does not
know it is being called over HTTP. A controller does not know SQLite exists.

Each layer gets what it needs through its constructor:

```ts
const runRepo = new RunRepository(db)
const metrics = new MetricsService(runRepo, teamRepo)
const controller = new MetricsController(metrics)
```

That means a test can hand a service a fake repository and no database is needed.

## The one place SQL lives outside a repository

The seed script writes its own `INSERT` statements instead of going through repository classes.

It is a one-shot loader, not application code — it never runs in production, it only writes, and
pushing tens of thousands of rows through a repository one call at a time would be slow and
would bend those classes into a shape nothing else needs. The rule it breaks exists to stop
business rules leaking into data access, and a loader has no business rules.

Everything that *reads* still goes through a repository, with no exceptions.

## Why SQLite is treated like Postgres

SQLite is here because it is one file and needs no setup. But every choice is made as if a real
Postgres sat behind it:

- No SQL outside a repository class. Ever.
- A service takes a repository interface, not a concrete class.
- Schema changes are numbered `.sql` files that only move forward. No "drop and recreate".
- Column types stay boring and portable. Timestamps stored as UTC text in ISO 8601. Money stored
  as whole cents in an integer, never a float.
- No SQLite-only tricks in query code.

Moving to Postgres should then be: swap the driver, adjust a handful of type names in the
migration files, keep everything above the repository line untouched.

## Where Zod lives

Schemas live in `packages/shared`. The API validates the incoming request with them. The web app
imports the same schema to type its responses. One definition, two users, no drift.

## What we deliberately left out

- No login and no permissions. One reviewer looks at this at a time.
- No caching layer. The data set is small and read from one file.
- No message queue, no background workers. Seed data is generated once by a script.
- No ORM. A repository class over the driver is less code and hides less.
