# Agent analytics

A dashboard for a company whose engineers run coding agents in the cloud. It answers four
questions, one per screen: **is this worth the money**, **is anything wrong right now**, **is it
helping me**, and **what actually happened on this run**.

Built for a take-home assignment. The data is generated, not real — see `docs/seed-data.md`.

## Run it

Needs [Bun](https://bun.sh). Nothing else — the database is a file.

```bash
./start.sh
```

That is the whole thing: it installs, builds the database, fills it with 180 days of
believable data, starts both servers, waits until they actually answer, and tells you what to
open. Ctrl+C stops both. `bun run start` does the same.

It prints a few places worth looking first — a team over its spending limit, a team whose
failures are nearly all one missing secret, and a run that reported success while leaking a
token.

If you would rather run the pieces yourself:

```bash
bun install
bun run seed        # migrations, then 180 days of data with a fixed seed
bun run api         # the service, on :3001
bun run web         # the dashboard, on :5173
```

```bash
bun test            # every check
bun run typecheck   # types across the whole workspace
```

## How it is laid out

```
apps/web        the dashboard people look at   (React, Vite, Recharts)
apps/api        the service that feeds it      (Bun, SQLite)
packages/shared types and Zod schemas used by both
docs/           why things are the way they are
artifacts/      research notes and wireframes
```

The API is split into three layers that each do one job. A controller reads the request and
checks it. A service works out the answer. A repository talks to the database. Arrows only point
one way, and each piece gets what it needs through its constructor — which is why a service can
be tested with a fake repository and no database at all.

Storage is SQLite because it needs no setup, but it is written as though it were Postgres: all
SQL lives in repository classes, schema changes are numbered forward-only files, money is whole
cents in an integer, and times are UTC text. Moving to Postgres should be a driver swap.

## Where to read next

Start with **`docs/product-brief.md`** — what this is and the two things it deliberately refuses
to show. Then **`docs/metrics.md`**, which defines every number on every screen: what goes on
top, what goes on the bottom, over what stretch of time, and what is left out. Those definitions
are the actual product; the charts are just a way of looking at them.

`CLAUDE.md` has an index of the rest.

## Three decisions worth knowing about

**The headline number shows its own guesswork.** "Value returned" is built from hours saved per
task and what an engineer hour costs. Both are guesses, so both are editable boxes at the top of
the screen rather than hidden constants. Next to them sits the break-even, worked out live from
whatever is on screen: at about $5.31 a finished task against an $85 engineer hour, this pays for
itself if a task saves more than about four minutes. That line is checkable, and it stays true no
matter what you believe the dials should say.

**No acceptance rate, and no lines of code.** Every competing product leads with them. Both get
gamed the day they become a target, with measured rises in bug rates and technical debt in orgs
that chased them. We use a harder substitute: did a person keep what the run produced.

**No leaderboards.** Per-person data exists but is only ever shown to that person, against their
own past. The moment a number can judge someone, people protect the number instead of doing the
work, and every figure on every screen becomes fiction.

`docs/decisions.md` has the rest, each with what it cost us.
