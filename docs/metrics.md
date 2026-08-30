# Metrics: every number, and exactly how it is worked out

If a number is on a screen, it is defined here: what goes on top, what goes on the bottom, over
what stretch of time, and what we leave out. A definition that lives only in code drifts.

Words used a lot, defined once:

- **Run** — one task handed to an agent, start to finish.
- **Turn** — one round of the model reading and replying inside a run. A run has many turns.
- **Task** — what a person wanted done. One task can take several runs if the first tries failed.
- **Token** — a chunk of text, about three quarters of a word. Providers charge by these.
- **p95** — the value 95 out of 100 results come in under. Used instead of the average because a
  handful of very slow results hide inside an average but show up here.

Five groups. Every screen is built from them.

---

## Group 1 — Adoption: are people using it

### Adoption rate
- **Top:** engineers who started at least one run in the window
- **Bottom:** **licensed seats** — everyone who has access, whether they ever tried it or not
- **Window:** last 7 days, last 30 days
- **Leaves out:** runs started by automation with no person behind them, counted separately

Dividing by seats, not by active users, is the whole point. Divide by active users and the
people who tried it once and gave up disappear from the maths, and a failed rollout looks
identical to a good one.

### Depth of use
Every seat lands in exactly one bucket, worked out over the last 30 days:

| Bucket | Rule |
|---|---|
| Deep | Runs several agents at once, or 20+ runs in 30 days |
| Regular | 5-19 runs in 30 days |
| Light | 1-4 runs in 30 days |
| Dormant | Has a seat, zero runs |

Counting heads tells you almost nothing. Someone handing whole tasks to an agent and someone
who ran it once out of curiosity are not the same person, and the gap between them is where the
rollout work is. The dormant bucket is money already being spent for nothing.

> **Two different counts of "seats", on purpose.** `orgs.licensed_seats` is what the company pays
> for. The engineers with an active seat are the people who actually hold one. Adoption rate
> divides by what you pay for, because that is the only version that can show money spent on
> nobody. The depth buckets cover the people who hold a seat, so they add up to that number rather
> than to the licensed count. In the seeded data the two are both 130 and the difference never
> shows — but if a real org ever pays for more seats than it hands out, that gap is money burning
> quietly, and the screen should show it rather than hide it inside a bucket.

### Sticking rate
- **Top:** engineers active in the last 7 days
- **Bottom:** engineers who have ever run anything
- **Answers:** of the people who tried it, do they keep coming back

---

## Group 2 — Outcome: did anything useful come out

### Success rate, reported two ways, always side by side
- **First try:** runs that finished successfully / all runs that reached an end
- **In the end:** tasks where some run in the chain eventually succeeded / all tasks
- **Window:** rolling 7 days and rolling 30 days, both shown
- **Leaves out:** runs still going (no end yet); runs a person cancelled in the first few
  seconds before the agent did anything, which are neither a win nor a loss — counted and shown
  on their own so they don't quietly vanish

Two numbers because they answer different questions. First try says how good the agent is on
its own. In the end says whether the person got what they needed. A big gap between them means
the agent works but wastes money getting there.

### Finished tasks
Count of task chains that ended in success. A task that took three attempts counts once, not
three times. This is what the money number divides by.

### What came out
Count of things produced, split by kind: pull request, commit, file, report. Plus the honest
one: **how many pull requests a person actually merged.** A run that opens a pull request nobody
merges did not help anyone.

### Rework rate
- **Top:** merged changes from agent runs that were reverted or heavily rewritten within 14 days
- **Bottom:** all merged changes from agent runs
- **Sits next to:** finished tasks, always. This is the quality half of the pair.

---

## Group 3 — Money

### Cost of one run
Worked out from the raw token counts on each turn, priced at that model's rate:

```
turn cost = fresh input tokens   x input price
          + cache write tokens   x input price x cache write rate
          + cache read tokens    x input price x 0.1
          + output tokens        x output price
          + thinking tokens      x output price

run cost  = sum of every turn cost in the run
          + sum of every tool call cost in the run
```

Tools that charge by time — a sandbox, a browser, a code runner — are metered wherever they run,
not here. Each tool call stores the cents it cost, the same way a turn does. We do not keep an
hourly rate table for tools: the rate belongs to whoever bills for the tool, and copying it here
would give us a second number to keep in step with theirs. If a tool is free, the cost is zero.

Cached tokens are roughly a tenth the price of fresh ones and must never be lumped in with
them. Thinking tokens are billed at the output price, and a long reasoning pass can cost several
times the visible answer — so they get their own column.

Each price is stored as its own figure per million tokens — fresh input, cached input, cache
write, output — not as a multiplier off the input price. The ratios above are what providers
happen to charge today, not a rule; storing them separately means a provider changing one of
them is a new price row, not a code change.

Prices are kept in a table with a date on them, and a turn is priced at the rate in effect when
it ran. Prices change; old numbers must not silently change with them.

Money is stored as whole cents in an integer. Never a float.

### Cost per finished task
- **Top:** every cent spent on every run in the task chain, **including the attempts that failed**
- **Bottom:** count of tasks that finished
- **Headline is the median**, with the average and the worst case shown beside it

Failed attempts counting in the top is the fairness rule. A cheap model that fails half the time
and needs retries can cost more per finished task than an expensive one that gets it right
first. Reporting only the winning run's cost hides exactly the waste you were looking for.

The median leads because these costs are long-tailed — most runs are cheap, a few are wild, and
one runaway run can drag an average somewhere no real run has ever been. The average is still
shown, next to it, so the outlier is visible instead of absorbed.

### Tokens used
Raw counts, split into fresh input, cached input, output, thinking. Reported separately from
money on purpose: it lets you tell "we used more" apart from "the price changed".

### Budget and burn pace
- **Spent so far** against the team's monthly limit
- **Pace:** spent so far ÷ share of the month gone
- **Landing on:** pace projected to month end

80% of the budget gone on day 10 and 80% gone on day 28 are completely different situations and
the same bar would show them the same way. The pace is the number that matters.

Two lines per budget: a **warning line** that only warns, and a **stop line** that would block
new runs. A hard stop with nothing to fall back on just breaks someone's afternoon, so the
warning line is the one meant for daily use.

---

## Group 4 — Reliability: what broke and whose problem it is

### Failure rate by cause
- **Top:** runs that ended in failure, grouped by cause
- **Bottom:** all runs that reached an end
- **Window:** rolling 7 and 30 days

The causes, kept short and non-overlapping so the chart stays readable:

| Cause | Whose problem |
|---|---|
| Missing permission | Org setup |
| Missing secret or login | Org setup |
| Tool not available | Org setup |
| Network or sandbox blocked | Org setup, usually on purpose |
| Hit a token or time limit | Org setup |
| Dependency install failed | Task |
| Ran out of room for context | Platform |
| Infrastructure crash | Platform |
| Rate limited | Platform |
| Model refused | Task |
| Tests failed | Task |
| Nothing useful produced | Task |

A cancelled run is not in this table on purpose. It has no cause and no blame — a person
changed their mind, which is not a fault of anything. It is carried entirely by the run's status,
counted on its own, and left out of both halves of the failure rate.

**Whose problem is the important column.** Split three ways: **org setup**, **platform**,
**task**. Org-setup failures are the ones somebody can go and fix this afternoon by handing the
agent the credential it kept asking for — those are what the dashboard should nag about.
Platform failures are ours. Task failures are the job being hard, and are not a sign anything is
broken.

Without this split the failure chart is just a wall of red that nobody can act on.

### Quiet failures
A run that reported success but did not actually do the job. Flagged with its own marker,
counted on its own. Named separately because nothing in the log complains about these, which
makes them the ones that hurt.

### Retry rate
Share of tasks that needed more than one run. A low final failure rate with a high retry rate
still means real money spent on do-overs.

### Time before giving up

How long a failing run went before it stopped. Catches the slow-motion failures that burn budget
for an hour before anyone notices.

**This one counts runs that timed out; the speed percentiles above do not.** That looks like a
contradiction and is not. For speed, a timed-out run has a fake duration — the clock stopped at
the limit, not when the work would have ended — so including it drags the percentiles down and a
rise in timeouts reads as the system getting faster. For this number, a run that burned its entire
limit before giving up **is** exactly the slow-motion failure being looked for, so leaving it out
would hide the very thing the number exists to find.

Same rows, opposite treatment, because the two numbers are asking different questions.

---

## Group 5 — Rules: an agent tried something it should not have

Every flag carries three things: what kind, how bad, and what happened to it.

**Kinds we record:** suspected prompt injection, goal hijacked, tool used in an unsafe way,
asked for more access than needed, tried a blocked domain, a secret showed up somewhere it
shouldn't, ran an unsafe command, tried to send data outside the network, spend cap crossed.

**How bad:**
- **Low** — worth logging, nothing to do. The wall blocked it, exactly as designed.
- **Medium** — someone should look this week.
- **High** — tell a person now. Data heading outside, or a command that cannot be undone.

**What happened to it:** confirmed, expected and dismissed, still being looked at.

**Shown as a trend, not just a count.** One team with ten low flags a day is background noise.
A team that suddenly gets a kind of flag it has never had before is the thing worth putting at
the top of the screen. We rank flags by "new for this team", not by raw count.

We also track how often a flag gets dismissed as expected. A rule that is wrong most of the time
needs retuning, not ignoring.

---

## Speed

Two different measurements. Never labelled just "latency", because that word alone doesn't say
which one.

- **Turn time** — how long one model reply took. p50, p95, p99 across all turns.
- **Run time** — wall clock for the whole task, including tools and waiting. p50, p95, p99
  across finished runs.

**Runs that failed on a timeout are charted separately, never blended in.** A timeout caps the
duration at the limit, which pulls the percentiles down and looks exactly like getting faster
when what really happened is more runs gave up sooner.

### How percentiles are worked out
Straight from the raw rows in one pass, using a window function over the ordered values for the
period asked for.

**Percentiles are never averaged.** A percentile is a position in a sorted list, not a quantity.
Averaging five daily p99s does not give you the week's p99 — a worked example from the field had
the average of per-host p99s reporting 550ms when the true figure was 1000ms, understating the
tail by almost half. Every percentile on this dashboard is computed once, over the raw rows for
the exact window on screen.

> `ponytail:` exact percentiles over raw rows. Fine at our size and always correct. The upgrade
> path, if the row count ever reaches the billions, is a t-digest sketch stored per day — which
> can be merged across days and still answer p95 correctly. An average per day cannot, so we
> never store one.

---

## Comparing teams of different sizes

A three-person team's success rate swings from 100% to 67% on a single bad run. A forty-person
team's barely twitches. Put both on the same bar chart and the small team looks dramatic when
nothing happened.

So: **team comparisons always use rates, and always show the run count next to the rate.** A 90%
success rate off 5 runs and off 500 runs are not the same claim.

Where a view is framed as a ranking, each team's rate carries a band sized to its run count, and
a team is only called out when it falls outside the band for its size. The chart says, in plain
words underneath: "the band is the range you'd expect from luck alone, given how many runs this
team has done."

---

## Things these numbers get wrong, and what we did about it

| The trap | What we did |
|---|---|
| Only counting people who stuck around makes everything look better than it is | Adoption divides by seats, not by active users |
| "Today" means different things in different countries | Every time stored in UTC with the person's offset kept; the org day is anchored to UTC and the screen says so |
| Runs still going have no duration or final cost yet | Every run-level number filters to finished runs only; runs in progress get their own live count so they aren't silently dropped |
| One task retried three times looks like three tasks | Retries carry a parent run id; counts collapse the chain to one task |
| One runaway run drags the average somewhere unreal | Median leads, average and worst case shown beside it |
| People change behaviour once they know a number is watched | No single-number leaderboards; every volume number is paired with a quality one, so gaming one shows up as damage in the other |
| A tool grading its own homework | Noted openly where a real build needs an outside check — merged pull requests and reverts are the closest we get in this build |
