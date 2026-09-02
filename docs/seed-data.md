# Seed data

There is no real company behind this dashboard, so every screen only looks honest if the made-up
data behaves like a real org's data would — messy, uneven, a little embarrassing in places. Clean,
even, round numbers are the tell that data is fake. This document says exactly how uneven ours is,
and why.

## The shape of the imaginary org

One org. Eight teams. 130 engineers (licensed seats) in total. Four models. 180 days of history —
about six months, enough for the org screen's month-over-month view to show real movement, and
enough weeks for a team's budget and pace to have gone through a few different states.

| Team | Engineers | Started using it (day) | Note |
|---|---|---|---|
| Comet | 3 | Day 1 | Small, keen, day-one adopter — this is the three-person team `docs/metrics.md` warns can swing from 100% to 67% on a single run |
| Anchor | 40 | Day 1 | Largest team, day-one adopter — the forty-person team the same doc says barely twitches |
| Lighthouse | 6 | Day 1 | Small, day-one adopter |
| Foundry | 18 | Day 55 | Started mid-way, adoption climbing steadily since |
| Beacon | 12 | Day 70 | Started mid-way |
| Atlas | 22 | Day 95 | Started later, now sits close to its budget's warning line |
| Nova | 15 | Day 130 | Adopted fast and hard, then had a rough week — now over its stop line |
| Pinnacle | 14 | Day 165 | Barely started — about two weeks of activity, most seats still untouched |

Four models, priced differently, not all present for the whole 180 days:

| Model | Story |
|---|---|
| `legacy-helper` | Cheap, older, used only in the first 45 days, then nobody assigns it a new run again — still in the models table because old runs still point at it |
| `quickpatch-1` | Cheap and fast, used the whole 180 days, fails more often than the others. Its price drops by about 30% on day 100 — a real price change, so a run from day 90 and a run from day 110 are priced differently even though nothing about the run itself changed |
| `steady-coder` | The middle option — steady price, steady quality, used the whole window |
| `deep-thinker` | Expensive, heavy on thinking tokens, introduced on day 60 (didn't exist before then), and the most reliable of the four |

## How to make it believable

**Runs cluster in working hours, and drop off at weekends.** Weekday runs outnumber weekend runs
roughly five to one. Within a weekday, runs bunch up from about 8am to 7pm (the org's day is
anchored to UTC, per `docs/metrics.md`), thin out around a midday dip, and taper off outside those
hours rather than stopping dead — a few keen people always run something at 11pm.

**A few teams got in early, a few have barely started.** See the adoption-day column above: three
teams have been at it since day one, three joined mid-stream, and two are recent — one of those
two (Pinnacle) has only about two weeks of real activity by the end of the window.

**Some seats are dormant.** Across the org, roughly 18% of licensed seats have never run anything.
It isn't spread evenly: the day-one teams sit closer to 5-8% dormant (most people who were going
to try it, already have), and Pinnacle — barely started — sits closer to 60% dormant, because most
of its seats haven't been touched yet.

**Costs are long-tailed, so the median and the average visibly differ.** Most runs cost well under
a dollar. A smaller slice, mostly `deep-thinker` runs with a lot of thinking tokens or a lot of
tool time, cost somewhere between ten and forty dollars. A handful — a couple of runs a week,
across the whole org — spike past a hundred dollars, standing in for the runaway run that got
stuck in a loop. Generate this by deliberately drawing most run costs from a small, low range and
then spiking a small, fixed share of runs into the expensive tail on purpose, rather than drawing
every run's cost from one smooth curve that would hide the spikes.

## Facts the generator had to settle

These were not in the first draft of this document. The generator had to pick, so they are
written down here rather than living only in code.

**Day 180 is always today.** The generator used to pin day 1 to a fixed calendar date (Monday 2
March 2026, putting day 180 at 28 August 2026) chosen so the current month had about four weeks
of real activity behind it. That broke the moment the real calendar caught up to it: `GET
/api/budget-status` always asks for the actual current month, so once "today" moved past 28
August 2026, it asked for a month the seeded `budgets` table had no row for, and the org page's
budget table rendered empty — `teamsWithoutBudget: 8`, no spend, nothing to see. A fixed anchor
can only ever be fresh on the day it was chosen.

Day 1 is now worked out backwards from day 180, and day 180 is fixed to the day the seed actually
runs. `bun run seed` today gives a different day 1 than it will next month, but always the same
180-day shape ending today — so the budget screens, which read the real clock, never open on a
month the seed never heard of.

The trade-off: the current calendar month can now be anywhere from a single day old (the seed
run on the 1st) to nearly a full month old (run on the 31st), not reliably "about four weeks" the
way the fixed anchor guaranteed. Rather than fake a full month by quietly reporting last month's
numbers, Nova and Atlas's budget stories (below) are sized to whatever the month actually has —
which, on a short month, tells a sharper story than the original fixed anchor ever did: a team
that blew its whole month's budget in the first two days, not one that crept over it near month
end.

**Every other team's budget limit is sized off its own typical daily spend, never off this
month's spend-to-date.** The first version of this rolling anchor got this backwards: a team's
limit was `this month's organic spend ÷ a target utilization`, which is a fine way to land on a
plausible round number when "this month's spend" already covers ~28 days, but on a 2-day-old
month it sizes the limit for two days of activity and calls it a month. Every ordinary team then
reads as wildly over pace — not because anything about the team changed, but because the ruler
shrank with the calendar. `docs/metrics.md`'s "Budget and burn pace" section says exactly why this
is wrong: *"a limit is a monthly number and does not move with the calendar... get this backwards
and every team reads as wildly over pace early in the month, which makes 'over pace' the normal
state and kills the one signal this screen exists to give."*

The generator now sizes each ordinary team's limit from its own recent daily average (the last 30
days of its history, or its whole history if it's younger than that — see Pinnacle below) times
however many days are actually in the current month, divided by a target utilization (35-75%,
picked per team so no two teams land on the same round number). That average doesn't care how
much of the current month has elapsed, so a team's limit is the same whether the seed runs on the
2nd or the 29th, and spend-to-date naturally tracks day-of-month the way it would for a team that
hasn't changed its habits — pace reads near 1.0x and comfortably under the 80% warning line on any
day of the month, for every team except the two whose story says otherwise.

**Dormant seat rates per team.** The spec gave 5-8% for the day-one teams and about 60% for
Pinnacle. The rest are worked out from how long the team has been using it: Foundry 15%, Beacon
18%, Atlas 20%, Nova 28%. Org-wide this lands at 19%, close to the 18% the spec asks for.

**Model prices.** The spec described them only in relation to each other. The generator uses
concrete cents-per-million-token figures that keep every stated relationship exactly: legacy-helper
is the cheapest, deep-thinker is about five times steady-coder, and quickpatch-1's day-100 cut is
exactly 30%.

**Cache prices are worked out from the input price**, at a tenth for a cache read and 1.25x for a
cache write. `docs/data-model.md` stores them as their own columns because a provider could price
them however it likes; the generator just has to pick something, and a fixed ratio off the input
price is what the real providers actually do.

**Nova's rough week sizes itself to how much of the month has actually happened.** It used to be
a fixed days-160-166, chosen to land inside both Nova's active window and the (fixed) current
budget month, with two calmer weeks after it so the trend lines showed a recovery rather than
ending mid-crisis. With day 180 rolling to today, the current month can be as short as a single
day, and a fixed 20-days-back offset from day 180 can no longer be trusted to land inside it —
it would just as often land in the *previous* calendar month instead.

The rough week is now measured back from day 180 instead: a real week (7 days), or less if the
month itself is younger than a week, followed by up to two calmer weeks of recovery — but never
claiming more of either than the current month has actually had. Run the seed on the 28th of a
28-day month and this reproduces the original days 160-166 exactly. Run it on the 2nd and the
"rough week" is just today and yesterday, with no calmer recovery period left before day 180 —
which is the sharper story from the point above, not a broken one. Either way, the week — and so
the dozen high-severity flags it carries — always falls inside the month the budget screens are
reporting on, and never before Nova's own adoption day (130).

**One engineer changes team, on day 91.** `docs/data-model.md` makes a point of `runs.team_id`
being stamped at the moment a run starts, never looked up back through the engineer — a reorg
can't silently rewrite last quarter's numbers. That property is only checkable against the seed
if somebody's team actually changed, so exactly one engineer does: Nadia Larsson moves from
Anchor to Lighthouse, roughly the midpoint of the 180-day window. Both teams have been active
since day 1, so there's real history on both sides of the move — see the real run counts in the
table below. `engineers.team_id` holds only Lighthouse, where she is now; nothing about her
earlier runs changes because of the move. Picked
deterministically (the first non-dormant, non-light-tier engineer generated for Anchor), not by
name, so the fixed seed still gives identical output every run.

**Pinnacle's early failures repeat one cause.** The org-setup-heavy first-30-days story below
holds for every team, but by day 180 every other team is well past that window — Pinnacle
(adoption day 165) is the only one still inside it, which makes it the one team whose *current*
failure-by-cause chart actually shows the org-setup-heavy shape live. To make that legible rather
than theoretical, Pinnacle's runs fail somewhat more often than the org baseline while it's still
finding its footing, and most of its org-setup failures repeat the same cause — a missing secret
— instead of spreading evenly across all five. That is a real team stuck on one thing, which is
exactly the shape the team screen's "somebody can fix this in an afternoon" callout is built to
catch: it only fires once a single cause reaches half of a team's org-setup failures, and no team
reached that bar without this.

## What the generator actually produces

Run `bun run seed` and these are the real figures, not targets. Day 180 now rolls to today (see
above), so the exact counts below shift a little run to run depending on what day of the month it
is — captured here as run on 2 September 2026, two days into the month:

| | |
|---|---|
| Runs | 8,829 over 180 days |
| Turns / tool calls | 50,369 / 99,855 |
| Artifacts / rule flags | 6,356 / 191 |
| Nova this month | $2,070.28 against an $1,800 limit — over its stop line |
| Atlas this month | $3,149.92 against $4,000 — just under its warning line |
| Cost per finished task | median $0.25, average $4.68, worst $1,568.42 |
| Dormant seats | 18.5% org-wide, from near zero on day-one teams to 57% on Pinnacle |
| Weekday to weekend runs | about 5 to 1 |
| Retry chains | 7,406 tasks took one attempt, 665 took two, 27 took three, 3 took four |
| Engineer who changed teams | Nadia Larsson: 71 runs stamped `Anchor` before day 91, 84 runs stamped `Lighthouse` from day 91 on; `engineers.team_id` holds only Lighthouse |
| Team with a dominant failure cause | Pinnacle: 17 org-setup failures out of 24 total, 13 of those 17 (76%) are `missing_secret_or_login` |

The gap between the median and the average is the point. Most runs are small and cheap; a
handful are not. An average alone would tell you a typical task costs $4.68 when the typical task
actually costs 25 cents — which is exactly why the median leads on every screen.

**One team is over budget, one is right under its warning line.** Every team's monthly budget
carries a warning line at 80% of its limit and a stop line at 100%. Nova's limit is $1,800 for the
month; it has already spent about $2,070 — past its own stop line, the state a real system would
also need to show clearly since the block (if it existed) wouldn't erase spend that already
happened. Atlas's limit is $4,000; it has spent about $3,150 — 79%, just under its warning line, on
purpose, so the team screen has a team sitting right at the edge rather than only ever comfortably
under or dramatically over.

**Failures skew toward org-setup causes early in a team's adoption, then shift toward task
causes.** For a team's first 30 days of real activity, about half its failures are org-setup
causes — missing permission, missing secret, tool not available — the kind somebody can fix this
afternoon. After day 30, org-setup failures drop to around 10% of that team's failures and task
causes (tests failed, model refused, nothing useful produced) take over, at around 70%. A steady
10-15% platform-cause background rate runs underneath the whole time, for every team, since
platform failures are the product's problem, not any one team's stage of adoption.

**A handful of quiet failures.** About 2% of runs that report success are quietly wrong — flagged
as quiet failures, spread across every team so no single team's numbers hide them, with a slightly
higher rate on `quickpatch-1` runs, the cheapest and least reliable model.

**Rule flags are mostly low severity, with a couple of high ones clustered in one team.** Overall,
roughly 85% of flags are low severity, 10% medium, 5% high. The high-severity ones are not spread
evenly: about a dozen of them land inside Nova, inside a single week — the same rough week that
pushed Nova over its budget. One bad week, not a smear across the year.

## A fixed seed

The generator always runs from the same fixed random seed: **42**. Every time it runs — on a
laptop, in CI, six months from now — it makes exactly the same sequence of random choices: the
same 130 names, the same team each engineer lands on, the same run counts, the same costs down to
the cent, the same two teams pinned to the same budget story, the same dominant failure cause.

What is **not** identical run to run any more is the calendar. Day 180 is always today (see "Day
180 is always today" above), so every absolute date and timestamp shifts to match whenever the
seed actually runs — a run today and a run next month describe two different 180-day windows,
even though both come from the same seed and the same RNG sequence. Nova is always over its stop
line and Atlas always just under its warning line, but the actual dates that make up "this month"
move with the calendar.

This matters because acceptance tests and manual checks need to point at something specific and
have it still be there tomorrow: "Nova is over budget," "Comet's success rate swings on one run,"
"Team B's flag today is a kind it has never seen before." Those are all statements about shape and
relative structure, not about fixed dates, so they still hold on any day the seed is run. Service
and repository tests still build their own small, made-up rows rather than depending on the seed
data (see `docs/testing.md`) — the fixed seed is for the acceptance checklist, manual review, and
demos, where "the same story every time" is the point, not "the same timestamp every time."

## Roughly how many rows

| Table | Roughly | Note |
|---|---|---|
| `orgs` | 1 | |
| `teams` | 8 | |
| `engineers` | 130 | |
| `models` | 4 | |
| `budgets` | 8 | One row per team, holding this month's dollar limit and its two lines. Spent-so-far and pace are worked out live from `runs`, never stored, so they can't go stale |
| `runs` | ~9,000 | Anchor (40 people, active since day 1) accounts for the largest share, well over a third; Comet (3 people) only a few hundred over the whole window |
| `turns` | ~54,000 | About 6 turns per run on average, from a handful of very short cancelled runs up to a few dozen on long ones |
| `tool_calls` | ~110,000 | About 2 per turn on average; plenty of turns make none at all |
| `artifacts` | ~6,000 | Roughly one per successful run, a few runs producing more than one (a pull request and a commit together) |
| `policy_flags` | ~220 | Rare by design — see the severity mix above |

These are targets the generator aims for, not guarantees to the last row — the exact count moves
a little run to run within the fixed seed's own randomness, same as a real org's numbers would.

## How the seed script is run

```
bun run seed
```

defined in `apps/api/package.json`, living in `apps/api/src/seed/`. It:

1. Deletes and recreates the local SQLite file.
2. Runs every migration file forward, in order, so the schema matches exactly what the real
   service runs against.
3. Creates the org, the 8 teams, the 130 engineers, and the 4 models, using the fixed seed.
4. Walks forward day by day from day 1 to day 180, generating that day's runs (and their turns,
   tool calls, and artifacts) according to each team's adoption stage, working-hours pattern, and
   weekday/weekend split, plus that day's share of policy flags.
5. Prints a short summary when it finishes — row counts per table, and a few of the headline
   numbers (Nova's budget position, Comet's run count) — so a person can glance at the output and
   tell right away whether it came out looking like the org described above.

The script accepts an optional `--seed=` flag for exploring what different random data looks
like, but the committed default always uses seed 42, so `bun test`, the acceptance checklist, and
any screenshot taken of the running app all agree on the same data.
