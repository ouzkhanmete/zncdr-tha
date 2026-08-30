# API: every endpoint, what goes in, what comes back

This is the contract between the web app and the service. If a screen needs a number, it comes
from one of the calls below. If a call takes an input, it is checked with Zod before anything
else runs. The Zod schemas live in `packages/shared` — the web app imports the same ones it is
validated against, so the two sides cannot drift apart.

Rules that hold for every call, so they are not repeated below:

- Everything is JSON in, JSON out.
- Times are text, ISO 8601, UTC — e.g. `2026-08-01T00:00:00Z`. The org day is anchored to UTC.
- Money is a whole number of cents, e.g. `finishedTaskCostCents: 4250` for $42.50. Never a
  decimal.
- A rate is a plain fraction between 0 and 1, e.g. `0.82` means 82 percent. It is never handed
  back alone — the count it was worked out from sits next to it in the same shape.
- An id is a short string. Nothing below assumes a particular id format; that choice belongs to
  the data model.
- A controller only reads the request, checks it with Zod, calls a service, and shapes the
  reply. See "Keeping a controller thin" near the end for a full worked example.

---

## 1. Every endpoint, one line each

| Method | Path | What it is for |
|---|---|---|
| GET | `/api/filter-options` | The teams, agent kinds, and (if a team is given) engineers, for filling in the filter bar |
| GET | `/api/teams` | List every team, for a team picker |
| GET | `/api/metrics/summary` | The hero number: money spent against value returned |
| GET | `/api/metrics/adoption` | Adoption rate, depth buckets, sticking rate |
| GET | `/api/metrics/outcomes` | Success rate (first-try and eventual), what came out, rework rate |
| GET | `/api/metrics/cost` | Cost per finished task, tokens used |
| GET | `/api/metrics/reliability` | Failure rate by cause and blame, quiet failures, retry rate, time before giving up |
| GET | `/api/metrics/speed` | Turn time and run time percentiles, timed-out runs shown apart |
| GET | `/api/metrics/flags` | Rule flags added up by severity and by what happened to them |
| GET | `/api/metrics/in-progress` | Runs going right now — kept apart from every finished-run number above |
| GET | `/api/flags` | The individual rule flags, newest-kind-first, for a list you can page through |
| GET | `/api/budget-status` | A budget's lines, spend so far, and burn pace — for one team, or added up for the whole org |
| GET | `/api/teams/:teamId/budget` | The raw budget a team has set for a month, for prefilling the edit form |
| PUT | `/api/teams/:teamId/budget` | **The one write.** Create or update a team's monthly budget |
| GET | `/api/teams/:teamId/comparison` | This team's rate against the org's, with a band sized to its run count |
| GET | `/api/teams/comparison` | Every team's rate against the org's, all at once, for the org screen's "teams, compared fairly" chart |
| GET | `/api/trend` | Runs, finished tasks, success rate, and cost over time, for the org or one team |
| GET | `/api/engineers/:engineerId/overview` | One engineer's own numbers. Never compared to anyone |
| GET | `/api/engineers/:engineerId/trend` | That same engineer's numbers over time, as a trend line |
| GET | `/api/engineers/:engineerId/runs` | That engineer's own list of runs, to click into one |
| GET | `/api/runs` | Search runs across the org or one team, for drill-down tables |
| GET | `/api/runs/:runId` | Everything about one run: turns, tool calls, artifacts, flags, cause |

Twenty-two calls, twenty-one of them read-only. Nothing exposes the `models` table directly — it
only holds the price history the cost service uses to price a turn; no screen needs the raw
price list.

---

## 2. The shared filter set

Defined once here, referenced everywhere below by name.

**`RangeFilter`** — the three filters almost every metrics call takes:

```ts
{
  from?: string       // ISO 8601 UTC. Default: 30 days before "to".
  to?: string         // ISO 8601 UTC. Default: now.
  team?: string        // a team id. Left out: the whole org.
  agentKind?: string   // e.g. "code-fix". Left out: every kind.
}
```

`team` is what turns an org number into a team number. The org overview page and the team page
call the exact same endpoints — the team page just always sends `team`.

**Two kinds of window, and they do not mix:**

Some numbers are defined in `docs/metrics.md` as always shown two ways at once — a trailing
7-day figure next to a trailing 30-day figure, side by side, so you can see whether something is
a blip or a trend. **Adoption, success rate, and failure rate work this way.** Those three
endpoints ignore `from`/`to` and always compute both windows, ending "now" (or ending `to` if you
passed one). Every other metrics endpoint uses the plain `from`/`to` range, defaulting to the
last 30 days.

**`PageFilter`** — for the two list calls (`/api/flags`, `/api/runs`, and the engineer's run
list):

```ts
{
  limit?: number   // default 50, max 200
  offset?: number  // default 0
}
```

A page comes back as:

```ts
{
  items: T[]
  total: number   // how many rows match, so the web app can show "1-50 of 812"
  limit: number
  offset: number
}
```

---

## 3. Finding your way around: the small lookup calls

### `GET /api/filter-options`
Query: `team?: string`

Fills in the filter bar. If `team` is given, `engineers` is that team's engineers; otherwise it
is left empty (an org-wide filter bar has no engineer picker — the engineer page is reached by
clicking into an engineer, not by filtering for one).

```ts
{
  teams: { id: string; name: string }[]
  agentKinds: string[]
  engineers: { id: string; name: string }[]
}
```

### `GET /api/teams`
No query. Returns `{ id: string; name: string }[]`.

---

## 4. The org and team screens

Both screens are built from the same eight calls below. The org overview page calls them with no
`team`. The team page calls them with `team` set. Nothing else changes.

### `GET /api/metrics/summary`

**The two dials and their starting values.** The reply carries `defaults` of **$85 an hour** and
**1.0 hours saved per finished task**. Neither is a measurement — they are the guesses the whole
hero number rests on, which is exactly why they are editable on screen rather than buried here.

One hour is deliberately conservative. At 2.5 hours the seeded data reports a return of about
twenty-eight times what was spent, which reads as marketing and costs the reader their trust in
every other number on the page. The break-even in minutes is computed from the average cost per
finished task and the hourly rate alone — it never uses the hours-saved dial, so it stays true
whatever the reader sets that dial to.
Query: `RangeFilter` (`agentKind` applies; `team` applies).

The hero number: money spent against value returned. Two of its inputs — hours saved per
finished task, and what an engineer hour costs — are guesses a person can turn into a dial on
screen, so the server hands back the raw pieces and its own defaults, and the small bit of
multiplying happens live in the browser as the dial moves. No round trip needed for that part.

```ts
{
  from: string
  to: string
  finishedTasks: number
  moneySpentCents: number          // every run in the window, failed runs included
  defaults: {
    hoursSavedPerTask: number
    engineerHourlyCostCents: number
  }
}
```

The web app works out `valueReturnedCents = finishedTasks * hoursSavedPerTask *
engineerHourlyCostCents` and `netCents = valueReturnedCents - moneySpentCents` itself, using
whatever the two dials are currently set to.

### `GET /api/metrics/adoption`
Query: `team?`, `agentKind?` (fixed 7-day/30-day windows, no `from`/`to`).

```ts
{
  adoptionRate: {
    last7d: { activeEngineers: number; licensedSeats: number; rate: number }
    last30d: { activeEngineers: number; licensedSeats: number; rate: number }
  }
  depthOfUse: {           // always the trailing 30 days
    deep: number
    regular: number
    light: number
    dormant: number
    totalSeats: number
  }
  stickingRate: {
    activeInLast7d: number
    everRun: number
    rate: number
  }
}
```

### `GET /api/metrics/outcomes`
Query: `RangeFilter`. Success rate is fixed-window (7d/30d); outputs and rework rate use
`from`/`to`.

```ts
{
  successRate: {
    last7d: SuccessRateWindow
    last30d: SuccessRateWindow
  }
  from: string
  to: string
  finishedTasks: number
  outputs: { kind: "pull_request" | "commit" | "file" | "report"; count: number }[]
  mergedPullRequests: number
  reworkRate: { revertedOrRewritten: number; totalMerged: number; rate: number }
}

// shared shape:
type SuccessRateWindow = {
  firstTry: { successes: number; endedRuns: number; rate: number }
  eventual: { succeededTasks: number; totalTasks: number; rate: number }
  cancelledEarly: number   // shown on its own — neither a win nor a loss
}
```

### `GET /api/metrics/cost`
Query: `RangeFilter`.

```ts
{
  from: string
  to: string
  costPerFinishedTask: {
    medianCents: number
    averageCents: number
    worstCents: number
    finishedTasks: number
  }
  tokensUsed: {
    freshInput: number
    cachedInput: number
    output: number
    thinking: number
  }
}
```

### `GET /api/metrics/reliability`
Query: `RangeFilter`. Failure rate is fixed-window (7d/30d); the rest use `from`/`to`.

```ts
{
  failureRate: {
    last7d: FailureWindow
    last30d: FailureWindow
  }
  from: string
  to: string
  quietFailures: { count: number; rate: number }   // rate is of ended runs
  retryRate: { tasksNeedingRetry: number; totalTasks: number; rate: number }
  timeBeforeGivingUp: { p50Ms: number; p95Ms: number }
}

type FailureWindow = {
  endedRuns: number
  // Deliberately NOT `cancelledEarly`. That name belongs to SuccessRateWindow above and means
  // something narrower: cancelled within the first few seconds, before the agent did anything.
  // Here it means every cancelled run, whenever it was stopped. Reusing one name for two
  // different counts is how the two quietly drift into disagreeing.
  cancelled: number
  byBlame: { blame: "org_setup" | "platform" | "task"; count: number; rate: number }[]
  byCause: { cause: FailureCause; count: number; rate: number }[]
}

type FailureCause =
  | "missing_permission" | "missing_secret_or_login" | "tool_not_available"
  | "network_or_sandbox_blocked" | "hit_token_or_time_limit" | "dependency_install_failed"
  | "ran_out_of_context" | "infrastructure_crash" | "rate_limited"
  | "model_refused" | "tests_failed" | "nothing_useful_produced"
```

### `GET /api/metrics/speed`
Query: `RangeFilter`.

```ts
{
  from: string
  to: string
  turnTime: { p50Ms: number; p95Ms: number; p99Ms: number }
  runTime: { p50Ms: number; p95Ms: number; p99Ms: number }   // finished runs only
  timedOutRuns: number   // charted apart, never blended into runTime above
}
```

### `GET /api/metrics/flags`
Query: `RangeFilter`.

```ts
{
  from: string
  to: string
  bySeverity: { severity: "low" | "medium" | "high"; count: number }[]
  byStatus: { status: "confirmed" | "expected_and_dismissed" | "under_review"; count: number }[]
  dismissedExpectedRate: number
}
```

### `GET /api/metrics/in-progress`
Query: `team?`, `agentKind?`. No date range — this is what is happening right now, not a window.

```ts
{
  count: number
  costSoFarCents: number   // real money already spent by these runs, even though none has finished
}
```

See "Runs that have not finished yet" below for why this is its own call.

### `GET /api/flags`
Query: `RangeFilter`, `severity?`, `status?`, `kind?`, plus `PageFilter`. Sorted newest-kind-first
by default — a kind of flag a team has never had before is ranked ahead of ten more of a kind it
sees every day.

```ts
Page<{
  id: string
  runId: string
  kind: string          // one of the nine kinds in docs/metrics.md
  severity: "low" | "medium" | "high"
  status: "confirmed" | "expected_and_dismissed" | "under_review"
  isNewKindForScope: boolean
  createdAt: string
  teamId: string         // which team this flag's run belongs to
  teamName: string
}>
```

`teamId`/`teamName` are what the org-wide flags table shows on every row (`docs/ui.md`'s org
"Rules" section) — a caller that already scoped its own request with `team` already knows the
answer and can ignore them.

### `GET /api/trend`
Query: `team?: string`, `from?`, `to?` (default trailing 90 days), `interval?: "day" | "week"`
(default `"week"`), `agentKind?`.

The org and team equivalent of the engineer's own `/trend` below — same shape, scoped by an
optional team instead of one engineer. Leave `team` out for the org-wide line (the org screen's
"runs per week paired with success rate," using `interval=week`); pass it for one team's line
(the team screen's daily mini-charts, using `interval=day`) — same team-optional convention as
every other call in this section.

```ts
{
  interval: "day" | "week"
  points: {
    periodStart: string
    periodEnd: string
    runsStarted: number
    finishedTasks: number
    successRateFirstTry: number
    medianCostPerFinishedTaskCents: number | null   // null when nothing finished that period
  }[]
}
```

No new repository work was needed to back this: `RunRepository.listEndedRuns` and
`listTaskOutcomesStartedIn` (see `docs/data-model.md`) already take an optional `teamId` filter,
so the service that will implement this call can reuse them exactly as the engineer's own trend
will — call them org-wide (no `teamId`) or scoped to one team, then bucket the results into
day/week periods the same way for both.

---

## 5. Budgets — the team's own numbers, and the one write

### `GET /api/budget-status`
Query: `team?: string`, `month?: string` (default: the current UTC month, `"YYYY-MM"`).

Leave `team` out and the org's teams are added up into one figure — this is what the org overview
page's spend-vs-budget number calls. Pass `team` and you get that one team's own budget, spend,
and pace — what the team page calls.

```ts
{
  scope: "org" | "team"
  teamId: string | null
  month: string
  limitCents: number
  warnCents: number
  stopCents: number
  spentSoFarCents: number
  monthProgress: number          // share of the month gone, 0 to 1
  projectedLandingCents: number  // spentSoFarCents ÷ monthProgress — where this pace lands by month end
  warnLineCrossed: boolean
  stopLineCrossed: boolean
  // present only when scope is "org":
  teamsWithoutBudget?: number    // teams with no budget set for this month, left out of the totals above
  dailySpend: { date: string; cumulativeSpentCents: number }[]
}
```

`dailySpend` is one point per UTC calendar day of the month so far, month start through today,
running total — what the team screen's burn chart (`docs/ui.md`'s budget section) draws its
cumulative spend line from. `date` is a plain `"YYYY-MM-DD"` day, not a full timestamp. The
warning line, the stop line, today's marker, and the dashed projection to month end are all drawn
from the fields already above (`warnCents`, `stopCents`, `projectedLandingCents`, and today's own
entry — the array's last point) rather than repeated per day. Present for both `scope: "org"` and
`scope: "team"`, the same as every other field above.

### `GET /api/teams/:teamId/budget`
Query: `month?: string` (default: current UTC month). The raw setting, for prefilling the edit
form — not the spend numbers, which come from `budget-status` above.

```ts
{ teamId: string; month: string; limitCents: number; warnCents: number; stopCents: number } | null
```

`null` (with a 404, see errors below) when no one has set a budget for that team and month yet.

### `PUT /api/teams/:teamId/budget` — the one write in this whole API
Body:

```ts
{
  month: string        // "YYYY-MM"
  limitCents: number
  warnCents: number    // only warns
  stopCents: number     // blocks new runs
}
```

Creates the budget if this team has none for that month yet, otherwise replaces it. Returns the
same shape back, `200`. Two rules are enforced here:

1. **`warnCents` must be less than `stopCents`** — a warning that fires at the same moment as the
   stop, or after it, cannot warn anyone about anything.
2. **`stopCents` must not be above `limitCents`** — a stop line you can never reach is not a stop
   line. The usual shape is a warning at 80% of the limit and a stop at 100%, so `stopCents` and
   `limitCents` being equal is the normal case, not an error.

The second rule exists because the table has its own `CHECK` covering it. Without the same rule
here, a stop line above the limit would pass checking, reach the database, and come back as an
unexplained failure — the person setting a budget deserves to be told what is wrong. The rule
lives in both places on purpose: the API explains, the table guarantees. See errors
below for the exact response when that rule is broken.

### `GET /api/teams/:teamId/comparison`
Query: `metric?: "firstTry" | "eventual"` (default `"firstTry"`), `from?`, `to?` (default trailing
30 days), `agentKind?`.

```ts
{
  metric: "firstTry" | "eventual"
  team: { rate: number; runCount: number }
  org: { rate: number; runCount: number }
  band: { low: number; high: number }   // the spread you'd expect from luck alone, at this team's run count
  withinBand: boolean
  note: string   // the one sentence to print under the chart, worded exactly as docs/metrics.md
}
```

### `GET /api/teams/comparison`
Query: `metric?: "firstTry" | "eventual"` (default `"firstTry"`), `from?`, `to?` (default trailing
30 days), `agentKind?`.

The org-wide sibling of the call just above: every team plotted at once, each against a band
sized to its own run count, for the org overview's "Teams, compared fairly" chart (`docs/ui.md`)
— the per-team call answers for one team against the org; this answers for every team at once.

```ts
{
  metric: "firstTry" | "eventual"
  from: string
  to: string
  org: { rate: number; runCount: number }
  teams: {
    teamId: string
    teamName: string
    rate: number
    runCount: number
    band: { low: number; high: number }   // sized to this team's own run count
    withinBand: boolean
  }[]
}
```

**Routing note.** This path and `GET /api/teams/:teamId/comparison` share a prefix. An HTTP
router has to match the literal `comparison` segment before the `:teamId` wildcard for both to
resolve correctly — the same literal-before-parameter rule every router already applies to a path
like this; nothing new to invent, just something to get in the right order when the routes are
wired up in step 6.

No new repository work was needed to back this either, for the same reason as `/api/trend` above:
`RunRepository.listEndedRuns` / `listTaskOutcomesStartedIn` already generalize to "every team" by
simply leaving `teamId` out of the filter, so a service can fetch every ended run in the window
once and group it by `run.teamId` itself, the same grouping-in-the-service style `docs/decisions.md`
entry 10 already commits to for every other metric.

---

## 6. The engineer screen — their own numbers, nobody else's

None of these three calls take a `team` filter or return anyone to compare against. That is on
purpose — see `docs/product-brief.md`: an engineer's page compares them only to their own past.

### `GET /api/engineers/:engineerId/overview`
Query: `from?`, `to?` (default trailing 30 days), `agentKind?`.

```ts
{
  engineerId: string
  from: string
  to: string
  finishedTasks: number
  successRate: {
    firstTry: { successes: number; endedRuns: number; rate: number }
    eventual: { succeededTasks: number; totalTasks: number; rate: number }
  }
  costPerFinishedTask: { medianCents: number; averageCents: number; worstCents: number }
  outputs: { kind: "pull_request" | "commit" | "file" | "report"; count: number }[]
  mergedPullRequests: number
  quietFailures: number
  depthOfUse: "deep" | "regular" | "light" | "dormant"   // which bucket they're in — stated, not ranked
}
```

### `GET /api/engineers/:engineerId/trend`
Query: `from?`, `to?` (default trailing 90 days — long enough for a trend to show), `interval?:
"day" | "week"` (default `"week"`), `agentKind?`.

```ts
{
  interval: "day" | "week"
  points: {
    periodStart: string
    periodEnd: string
    runsStarted: number
    finishedTasks: number
    successRateFirstTry: number
    medianCostPerFinishedTaskCents: number | null   // null when nothing finished that period
  }[]
}
```

### `GET /api/engineers/:engineerId/runs`
Query: `from?`, `to?`, `status?`, `agentKind?`, plus `PageFilter`.

Returns `Page<RunSummary>` — see `RunSummary` under Run detail below. `teamId` and `engineerId`
are left off each row here since the whole list is already one engineer's.

---

## 7. Runs — search, and the full detail

### `GET /api/runs`
Query: `RangeFilter`, `engineer?: string`, `status?`, `blame?`, plus `PageFilter`. Used for any
drill-down table — "recent org-setup failures," "runs behind this flag," and so on.

Returns `Page<RunSummary>`:

```ts
type RunSummary = {
  id: string
  teamId: string
  engineerId: string | null   // null when trigger is "automation"
  agentKind: string
  trigger: "person" | "automation"
  repo: string | null    // null for tasks with no repo, like a report
  branch: string | null  // null whenever repo is
  parentRunId: string | null
  startedAt: string
  finishedAt: string | null
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out"
  failureCause: FailureCause | null
  blame: "org_setup" | "platform" | "task" | null
  isQuietFailure: boolean
  durationMs: number | null
  totalCostCents: number
  turnCount: number
  toolCallCount: number
  taskSummary: string   // short, one line -- see docs/data-model.md's runs.task_summary
  primaryOutputKind: "pull_request" | "commit" | "file" | "report" | null
}
```

**`taskSummary`** replaces "Run #4821" with something a reader can recognize — see
`docs/data-model.md`'s callout on `runs.task_summary` for why it is deliberately short and never
the full task text.

**`primaryOutputKind`** is the answer to gap 7: a run list needs to show one output icon per row
(`docs/ui.md`'s engineer "Recent runs" table, and the run search tables it shares a layout with).
Two ways to get there: put it on `RunSummary` itself, or make every caller fetch each run's
artifacts separately and derive it. **Chosen: on `RunSummary`.** A paged list of up to 200 rows
deriving this by calling `GET /api/runs/:runId` (or an artifacts endpoint) per row would be up to
200 extra round trips to render one column — exactly the kind of per-row fan-out a list screen
should never need. Null when the run produced nothing, which is most failed, cancelled, or
still-running rows. A run producing more than one artifact is rare (`docs/seed-data.md`: "a few
runs producing more than one"); when it happens, the earliest-created artifact wins — a
deterministic tiebreak, not a claim that a pull request matters more than a commit. Computed by
joining `RunRepository`'s run rows with `ArtifactRepository.listPrimaryKindByRunIds` in the
service that builds a `RunSummary`, not by adding an artifacts join to every run query in the
repository.

### `GET /api/runs/:runId`
Everything the run detail screen needs, in one call — the full timeline of one run.

```ts
type RunDetail = RunSummary & {
  taskAttempts: {           // every run in this task's chain, this one included
    runId: string
    attemptNumber: number
    status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out"
    startedAt: string
    totalCostCents: number
    isSelf: boolean
    failureCause: FailureCause | null   // why this attempt failed, when it didn't succeed
    blame: "org_setup" | "platform" | "task" | null
  }[]
  turns: {
    id: string
    index: number
    startedAt: string
    finishedAt: string
    model: string
    freshInputTokens: number
    cacheWriteTokens: number
    cacheReadTokens: number
    outputTokens: number
    thinkingTokens: number
    toolSeconds: number
    costCents: number
  }[]
  toolCalls: {
    id: string
    turnId: string
    name: string
    startedAt: string
    durationMs: number
    outcome: "success" | "error" | "timeout"
    summary: string
  }[]
  artifacts: {
    id: string
    kind: "pull_request" | "commit" | "file" | "report"
    url: string | null
    merged: boolean | null   // only meaningful for a pull request
    createdAt: string
  }[]
  policyFlags: {
    id: string
    turnId: string | null   // which turn tripped it, when one turn can be pointed to -- see below
    kind: string
    severity: "low" | "medium" | "high"
    status: "confirmed" | "expected_and_dismissed" | "under_review"
    detail: string
    createdAt: string
  }[]
}
```

**`policyFlags[].turnId` is nullable because not every flag can be pinned to one turn.** Most can
— an unsafe command, a secret exposed, a blocked domain — each happened inside one specific model
reply, and `policy_flags.turn_id` (`docs/data-model.md`) records exactly which one. But a flag
like a spend cap crossed is a property of the run as a whole, tripped by the run's running total
rather than by any single turn's action, so it has no turn to point at and `turn_id` stays null
for it in the database. The run detail screen uses this the same way: a flag with a `turnId`
is shown on that turn in the turn-by-turn breakdown (`docs/ui.md`'s "Turn by turn" section) *in
addition to* the run-level "Rules" card; a flag with a null `turnId` only ever appears in the
run-level card, because there is nowhere else honest to put it.

`taskAttempts[].failureCause`/`.blame` are what the run screen's attempt chain uses to annotate a
failed attempt with why it was retried (`docs/ui.md`: "the failure cause named on any attempt that
didn't succeed"). Both already existed on the underlying run and on `RunSummary` above; this is
only exposing them on the attempt-chain shape too, no new repository work needed —
`RunRepository.listChainMembers` already returns full run rows with both fields on them.

`404` if the id does not match a run.

---

## 7b. Four fields on the run screen that are close, not exact

The run detail shape asks for a little more than `docs/data-model.md` actually stores. Rather
than pretend otherwise:

| Field | What it really is | Why that is good enough |
|---|---|---|
| `RunToolCall.startedAt` | the parent turn's start time | `tool_calls` has a duration but no timestamp. A tool call happens inside its turn, and calls within a turn are ordered by id, so the timeline reads correctly — only the exact second is approximate |
| `RunToolCall.summary` | the target, else the error kind, else the tool name | there is no summary column. This is what a person would actually want to read on that row |
| `RunArtifact.url` | the `ref` column | a commit hash or a file path is not a link. Whether it becomes one depends on where the repo is hosted, which this product does not know |
| `RunPolicyFlag.detail` | the `resource` column | what the agent reached for, not a written sentence about it |

> `ponytail:` a timestamp on `tool_calls` is one migration away and would make the run timeline
> exact rather than close. Worth it when a screen needs the gap between two calls in the same
> turn — nothing does yet.

## 8. Errors — one shape, used everywhere

Every error comes back in the same envelope:

```ts
{
  error: {
    code: string       // short, stable, safe to branch on in code
    message: string    // one plain sentence, safe to show on screen
    details?: Record<string, string>   // which field, and what was wrong with it
  }
}
```

| Situation | Status | `code` |
|---|---|---|
| A query parameter or request body fails its Zod check | 400 | `bad_request` |
| An id in the path does not match anything (unknown run, team, engineer, or no budget set yet) | 404 | `not_found` |
| A budget's warning line is not below its stop line | 422 | `invalid_budget` |

**How the two get told apart in practice.** Both budget rules live on the shared Zod schema, so
a broken rule and a broken shape both come back as a parse failure. They are separated by the
kind of issue Zod reports: a rule written as a refinement raises a `custom` issue, and a
refinement only ever runs once the basic shape has already passed. So a failure made up entirely
of `custom` issues is a rule violation — `422` — and anything else is a malformed request —
`400`. Keeping both rules in one schema means the API and the database cannot drift apart about
what a valid budget is, which matters more than having two schemas.
| A budget's stop line is above its limit | 422 | `invalid_budget` |
| Anything else goes wrong | 500 | `internal_error` |

`400` and `422` both mean "the request did not go through," but for different reasons: `400`
means the shape was wrong before anyone even looked at what it meant — a missing field, a date
that is not a date. `422` means the shape was fine and a rule caught it — the warn-above-stop
case is the one place in this API that happens. Example:

```json
{
  "error": {
    "code": "invalid_budget",
    "message": "The warning line has to sit below the stop line.",
    "details": { "warnCents": "8000000 is not less than stopCents (5000000)" }
  }
}
```

---

## 9. Keeping a controller thin

A controller does three things and nothing else: check the request with Zod, call a service,
shape the reply. No SQL, no rule about warn lines or percentiles, ever appears in one. Here is
the full budget-write controller:

```ts
export function updateBudget(budgets: BudgetService) {
  return async (req: Request): Promise<Response> => {
    const params = TeamIdParam.safeParse(req.params)
    const body = BudgetInput.safeParse(await req.json())
    if (!params.success || !body.success) {
      return errorReply(400, "bad_request", "That budget request isn't shaped right.")
    }

    try {
      const saved = await budgets.setBudget(params.data.teamId, body.data)
      return jsonReply(200, BudgetResponse.parse(saved))
    } catch (err) {
      if (err instanceof InvalidBudgetError) {
        return errorReply(422, "invalid_budget", err.message, err.details)
      }
      throw err
    }
  }
}
```

`budgets.setBudget` is where "warn must sit below stop" actually lives, inside `BudgetService`.
The controller does not know that rule exists — it only knows what to do when the service says
no.

---

## 10. Runs that have not finished yet

A run with no `finishedAt` has no duration, no final cost, and no place in a success or failure
count — counting it anywhere in those numbers would be counting something that has not happened
yet. So every metrics call above — outcomes, cost, reliability, speed — filters to runs with
status `succeeded`, `failed`, `cancelled`, or `timed_out`, and nowhere else. Runs still `running` get
exactly one home: `GET /api/metrics/in-progress`, a live count kept apart on purpose so it is
never silently folded into, or silently missing from, a finished-run number.

The one exception is money already spent: `budget-status`'s `spentSoFarCents` **does** include
cost run up by runs still in progress, because that money is real and already gone the moment a
turn runs, whether or not the run it belongs to has finished. Finished-run numbers describe
outcomes, which a run in progress does not have yet. Spend describes cash, which it already
does.

---

## 11. Worked out on the server, or raw rows for the web app to add up?

**Worked out on the server, always.** A median, a percentile, a rate, a run-count band — every
one of these has one correct way to compute it and several plausible-looking wrong ones, and
`docs/metrics.md` spends a whole section on exactly that (averaging five days of p99s does not
give you the week's p99). That arithmetic belongs in one service, matched to one definition, not
copied into the browser where it can quietly drift out of step. The one deliberate exception is
the hero number's two dials — hours saved per task, and the cost of an engineer hour — which a
person changes by hand on screen, so the server hands back the raw pieces and its own defaults,
and the tiny bit of multiplying happens live in the browser with no round trip. Everything else
comes back already done.
