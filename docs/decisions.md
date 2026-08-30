# Decisions and what we gave up

Each entry: what we chose, what it cost us, and what would make us change our mind.

---

## 1. The hero number has visible dials

**Chose:** money spent against value returned, where "value returned" is built from two numbers
the viewer sets themselves — hours saved per finished task, and what an engineer hour costs.
Both sit in editable boxes at the top of the page.

**Gave up:** the comfort of a single authoritative number. Someone can turn the dial until the
answer flatters them.

**Why anyway:** every source said the same thing — buyers do not act on a number whose
assumptions are hidden, and the whole market of outside measurement tools exists because people
do not trust a tool grading its own homework. Showing the guess makes it arguable. A number you
can argue with is one you eventually believe. Hiding it would not make it more true, only less
checkable.

**Would change if:** we could connect to real ticket and git history and measure time saved
instead of assuming it.

---

## 2. No acceptance rate, no lines of code

**Chose:** to leave out the two numbers that every competing product puts front and centre.

**Gave up:** looking familiar. A buyer comparing dashboards side by side will notice these
missing.

**Why anyway:** both get gamed the day they become a target — people rubber-stamp suggestions or
ask for padded changes. Independent measurements found bug rates and technical debt rising in
orgs that chased them. We use a harder substitute: did a person keep what the run produced
(merged, and still there 14 days later).

**Would change if:** never. This is the point of the product.

---

## 3. No leaderboards, and the engineer page compares you only to your past self

**Chose:** per-person data exists, but is only ever shown against that person's own history. No
sorted list of people. No per-person numbers on the manager's view.

**Gave up:** finding internal champions at a glance, which is a real and useful thing to want.

**Why anyway:** the single most repeated warning in the research. The moment per-person numbers
can judge someone, people optimise the number instead of the work, and the whole dashboard turns
into fiction. The cost of losing the champion-spotting feature is much smaller than the cost of
losing trust in every number on every screen.

---

## 4. Speed never appears without quality beside it

**Chose:** a layout rule, enforced per screen: finished tasks sits next to rework rate, runs per
week next to success rate, spend next to what the spend bought.

**Gave up:** cleaner, punchier screens. Pairs take twice the room.

**Why anyway:** when orgs added AI, the speed numbers moved first and looked great; the breakage
showed up weeks later. A dashboard showing only the first half is not neutral — it actively
pushes people toward the bad outcome.

---

## 5. SQLite, written as though it were Postgres

**Chose:** one file, no setup, but every access goes through a repository class, schema changes
are numbered forward-only files, money is whole cents in an integer, times are UTC text, and no
SQLite-only tricks appear anywhere.

**Gave up:** some speed and convenience. Real Postgres would give us proper enum types, better
index choices, and a real percentile function instead of a window function.

**Why anyway:** the reviewer should be able to clone and run with no database to install, and
the move to Postgres should be a driver swap plus a handful of type names, not a rewrite.

---

## 6. No pre-worked-out daily summary tables

**Chose:** every number is computed from raw rows at request time.

**Gave up:** speed at large scale. A real deployment would build daily summary rows overnight.

**Why anyway:** our seeded data set is small. A summary table is a second copy of the truth, and
a second copy drifts. More importantly, if a daily summary stores an average, the percentiles
can never be rebuilt correctly from it — so a wrong summary table is worse than none.

> `ponytail:` raw-row queries. The upgrade path is a daily summary table that stores a
> distribution sketch rather than an average, so percentiles survive the rollup.

---

## 7. The only thing you can edit is a budget

**Chose:** budgets and spend caps are the write surface. Everything else is read-only.

**Gave up:** flag triage (marking a rule-break as a false alarm) and saved views, both of which
we researched and both of which would be useful.

**Why anyway:** a budget is the only number on the screen a leader can act on directly and
immediately. The rest of the dashboard reports what already happened. One well-built write path
that exercises the whole stack — validation, rules, storage — shows more than three shallow ones.

**Would change if:** the flag list grows enough that working through it needs state.

---

## 8. Every failure carries whose problem it is

**Chose:** every failed run is tagged org setup, platform, or task, alongside its cause.

**Gave up:** a little honesty about how hard that call is at the edges — a dependency install
failing could be a broken environment or a broken registry.

**Why anyway:** without this column the failure chart is a wall of red nobody can act on. With
it, a manager can see that half their failures are a missing credential somebody can hand over
this afternoon. It turns a report into a to-do list.

---

## 9. Percentiles are computed exactly, and never averaged

**Chose:** one pass over the raw rows for exactly the window on screen.

**Gave up:** nothing at our size.

**Why anyway:** averaging percentiles is not slightly wrong, it is arbitrarily wrong — a
published example had the average of per-host p99s reading 550ms when the real figure was
1000ms. Any design that stores a daily average and hopes to recover a percentile later is broken
from the start, so we never store one.

---

## 10. The maths lives in the service, not in the SQL

**Chose:** a repository fetches and groups; a service works out every median, rate and
percentile. `docs/data-model.md` section 4 shows the same numbers as working SQL, and that SQL is
correct — but it is the *reference definition*, not where the code does it.

**Gave up:** doing the arithmetic in the database, which is faster and is what a repository could
easily have done. Every raw row now crosses the boundary into TypeScript before it becomes a
number.

**Why anyway:** the metric definitions are the product. They are business rules, and business
rules belong in a service. Put them in SQL and the only way to test "does a failed attempt count
toward cost per finished task" is to stand up a database; put them in a service and the same test
runs against a fake repository in a millisecond. Given the definitions are the thing most likely
to be got wrong, and most likely to be argued about, making them cheap to test is worth more than
making them fast to run.

The repository still does the part SQL is genuinely better at: collapsing a retry chain with
`COALESCE(parent_run_id, id)`, filtering to finished runs, and joining — so what crosses the
boundary is a small grouped row set, not a table scan.

> `ponytail:` all raw rows for the window cross into TypeScript before becoming a percentile.
> Fine at our size and always exactly right. This is the same ceiling `docs/metrics.md` already
> names: when the row count makes it hurt, the fix is a daily summary holding a distribution
> sketch, not an average — an average can never be turned back into a percentile.

**Would change if:** a single window's raw rows stopped fitting comfortably in memory.

---

## 10. Runs that timed out are charted apart from the rest

**Chose:** timeouts get their own line rather than being blended into normal run times.

**Gave up:** one simpler chart.

**Why anyway:** a timeout caps a run's duration at the limit. Blend them in and a rise in
timeouts looks exactly like the system getting faster. That is the most misleading thing a
speed chart can do.
