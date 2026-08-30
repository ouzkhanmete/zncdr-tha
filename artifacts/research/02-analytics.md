# Measuring a fleet of AI coding agents: event model, math, and traps

This is a plain-language guide to building the numbers behind an org dashboard for a
service where people run AI coding agents. It covers what raw facts to record, how to
roll them up without double-counting, exact formulas for the headline numbers, how to
do percentiles honestly, and the ways these numbers commonly lie.

A quick word list used below, defined once:
- **Event**: one fact about something that happened, saved with a timestamp.
- **Run**: one full task given to an agent, start to finish (could be many back-and-forth
  turns and tool calls).
- **Turn**: one round where the model reads context and produces a reply (may include
  tool calls).
- **Token**: a chunk of text the model reads or writes; this is what model providers
  charge by.
- **Percentile (p95, p99)**: the value below which 95% (or 99%) of a set of numbers
  fall. Used instead of the average because a few very slow or very expensive runs can
  hide inside an average but stand out at the tail.
- **Grain**: the smallest unit a table's rows represent (one event, one run, one day).
- **Rollup**: adding rows of a fine-grained table together to make a coarser one (turn
  rows added up into run rows, run rows added up into daily team rows).

---

## 1. Event model: the raw facts to record

The rule: record the smallest fact once, tag it with every ID you might later want to
group by, and never compute a number at write time that you could instead compute later
from raw facts. If you bake in "success" or "cost" at write time and the definition
changes next quarter, old data can't be recomputed.

Every event below should carry a shared set of "who / where" tags so any of them can be
joined and grouped later without guessing:

**Shared tags on every event:**
- `event_id` (unique, so retries/redelivery can be told apart from real duplicates)
- `event_time` (UTC, plus the actual timezone offset of the person or scheduler that
  triggered it, so day-boundaries can be redrawn later — see the timezone trap below)
- `org_id`, `team_id`, `engineer_id` (the acting person or service account)
- `run_id` (the task this event belongs to)
- `agent_type` / `model_id` / `model_version` (which agent config and which model)
- `session_id` (if a person kept the same working session across multiple runs)
- `schema_version` (so old events stay decodable when you add fields)

**1. `run_started`**
- `run_id`, `trigger` (manual / scheduled / CI / API), `repo_id`, `branch`,
  `task_description_hash` (don't store raw text if it may be sensitive — hash or link
  to a separate access-controlled store), `initial_prompt_token_count`,
  `policy_profile_id` (which rules applied), `parent_run_id` (if this run is a retry or
  follow-up of another — critical for not double-counting, see Section 5)

**2. `run_finished`**
- `run_id`, `end_status` (`succeeded` / `failed` / `cancelled` / `timed_out`),
  `end_reason` (free-text or enum: user cancelled, hit turn limit, tool crashed, policy
  blocked, model error), `duration_ms` (wall clock, start to finish),
  `total_turns`, `total_tool_calls`, `total_tokens_in`, `total_tokens_out`,
  `total_cost_usd` (computed at finish, but from raw per-turn token counts and the price
  table in effect at each turn — prices change), `artifacts_produced_count`

**3. `model_turn`** (one per model call/reply — this is the atomic AI-usage row)
- `run_id`, `turn_id`, `turn_index` (1st, 2nd, 3rd turn in the run),
  `model_id`, `model_version`, `provider` (e.g. Anthropic), `tokens_in`, `tokens_out`,
  `cached_tokens_in` (tokens served from a prompt cache — cheaper, must not be billed
  or counted the same as fresh tokens), `latency_ms` (time for this one call),
  `time_to_first_chunk_ms` (if streaming), `finish_reason` (stop / length limit / tool
  call / error), `error_type` (if it errored), `cost_usd` (priced from tokens_in/out at
  this turn's price)

  This maps closely to the industry-standard shape for this exact thing: OpenTelemetry
  (an open standard for what to record about software behavior) has a GenAI ("generative
  AI") convention defining a metric called `gen_ai.client.token.usage` (a running count
  tagged by `gen_ai.token.type` — input vs. output vs. cached) and
  `gen_ai.client.operation.duration` (how long each model call took, tagged with
  `error.type` when it failed). Reusing these names means any off-the-shelf monitoring
  tool already knows how to read your data.
  Source: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md

**4. `tool_call`** (one per action the agent takes — editing a file, running a test,
   calling an API)
- `run_id`, `turn_id`, `tool_call_id`, `tool_name` (e.g. `edit_file`, `run_tests`,
  `git_commit`), `duration_ms`, `outcome` (success / error / denied_by_policy),
  `error_type`, `bytes_changed` or `lines_changed` (if a code edit), `target_resource`
  (file path, repo, or external system touched — needed for blast-radius and audit
  questions later)

**5. `artifact_produced`** (a concrete output: a commit, a PR, a file, a test report)
- `run_id`, `artifact_type` (commit / pull_request / file / report),
  `artifact_ref` (commit SHA, PR URL, file path), `created_at`

**6. `policy_check`** (any rule evaluation — permission gate, guardrail, budget cap)
- `run_id`, `turn_id` (nullable if it's a run-level check), `policy_id`, `policy_name`,
  `decision` (allow / block / warn / require_approval), `reason_code`,
  `resource_targeted`

**7. `error`** (any failure, whether it stopped the run or was recovered from)
- `run_id`, `turn_id` (nullable), `error_type` (categorized: model_error, tool_error,
  timeout, policy_block, user_cancelled, infra_error), `error_message_hash`,
  `recovered` (true if the agent retried and continued), `is_terminal` (true if this
  ended the run)

Why split `run_finished` from `model_turn` and `tool_call` rather than one big row per
run: a run can have dozens of turns and tool calls, each with its own latency and cost.
If you only keep one row per run you can never compute "how slow is a single model
reply" (a turn-level question) separately from "how slow is the whole task" (a run-level
question) — see Section 3 on latency.

---

## 2. Grain and rollup: one atom, three levels of adding up

**The one atomic row that everything else is built from is the `model_turn` row** (plus
its sibling `tool_call` rows). Everything above it — a run, a day, a team, an org — is
just that atom summed or counted differently. Never store a second, separately-computed
copy of "total cost" or "total tokens" at a higher level as the source of truth; always
be able to regenerate it from turns. Keep one summary table for speed, but treat it as a
cache, not a ledger.

**Rollup path (no double counting):**

```
model_turn / tool_call   (atom: one model call or one tool action)
        |  group by run_id, sum tokens/cost/duration, count turns
        v
run  (one row per run_id: run_finished carries the run-level summary)
        |  group by engineer_id + day, sum/count runs
        v
engineer-day  (pre-aggregated: one row per person per day)
        |  group by team_id + day
        v
team-day
        |  group by org_id + day
        v
org-day
```

The two rules that prevent double counting:
1. **Every event belongs to exactly one `run_id`, and every run belongs to exactly one
   `engineer_id` and one `team_id` at the time it ran.** If someone changes teams, keep
   the team_id the run was actually attributed to at run time — don't let a later
   re-org silently rewrite history (this is called a "slowly changing dimension"
   problem; solve it by stamping team_id onto the run event itself, not by joining to a
   "current team" lookup table later).
2. **A retry or follow-up gets a new `run_id` but carries `parent_run_id`.** This keeps
   it countable as its own attempt (for failure-rate math) while still letting you
   collapse a retry chain into "one task, eventually succeeded" when that's the question
   being asked (see the retry trap in Section 5).

**Why pre-aggregate daily tables:** a dashboard that scans millions of raw `model_turn`
rows every time someone loads a chart is slow and expensive. Building `engineer-day`,
`team-day`, and `org-day` tables once (e.g. overnight, or continuously updated) means
the dashboard just adds up a handful of daily rows. The tradeoff: anything that needs
the exact underlying distribution — most importantly, percentiles — cannot be correctly
rebuilt from a daily table that only stored an average. Section 3 covers the fix
(store a compressed histogram in the daily row instead of just an average).

---

## 3. Exact metric definitions

For each metric: what's on top (numerator), what's on the bottom (denominator), what
time window, and what's deliberately left out.

### Success rate
- **Numerator:** count of runs where `run_finished.end_status = 'succeeded'`
- **Denominator:** count of runs where `run_finished` exists at all (i.e., the run
  reached a terminal state) in the same window
- **Window:** rolling 7-day and rolling 30-day, both shown side by side (7-day reacts
  fast to a new regression; 30-day smooths out noise)
- **Excludes:** runs still in progress (no `run_finished` row yet — see Section 5,
  "in-flight runs"); runs cancelled by the user before the agent did any work (these are
  neither a success nor a failure of the agent — tag `end_reason = user_cancelled_early`
  and drop from both top and bottom, but report the count separately so it doesn't
  vanish)
- **Decision to make explicit:** does a retry that eventually succeeds count as one
  success, or does the failed first attempt also count as a failure? Recommendation:
  report both — "first-attempt success rate" (each `run_id` counted on its own) and
  "eventual success rate" (collapse a `parent_run_id` chain to its final outcome). They
  answer different questions: the first tells you how good the agent is on its own; the
  second tells you whether the user got what they needed.

### Adoption / active users
- **Numerator:** distinct `engineer_id` with at least one `run_started` event
- **Denominator:** two versions, reported together, never just one:
  - *Adoption rate* = active engineers ÷ **licensed seats** (everyone who has access,
    whether or not they've tried it) — this is the number that answers "is the
    rollout working"
  - *Engagement rate* = engineers active in the last 7 days ÷ engineers active at least
    once ever — this answers "of people who tried it, do they keep using it"
- **Window:** daily active (DAU), 7-day active (WAU), 30-day active (MAU), all as of a
  given day, following the standard product-analytics definition: count of distinct
  users who fired the qualifying event in that trailing window.
  Source: https://amplitude.com/glossary/terms/monthly-active-users ,
  https://docs.mixpanel.com/guides/strategic-playbooks/guide-to-product-analytics/get-to-know-your-users
- **Excludes:** service accounts, CI-triggered runs with no human `engineer_id`, unless
  you're deliberately reporting those separately as "automated usage"
- **Why licensed seats matters:** using only "active users" as the denominator for
  adoption hides the people who never started, which is exactly what you need to see to
  know if the rollout is working. See the survivorship-bias trap in Section 5.

### Cost per finished task
- **Numerator:** sum of `cost_usd` across all `model_turn` rows for a run (plus any
  metered tool cost, if tools themselves cost money) — summed only over runs with a
  `run_finished` row
- **Denominator:** count of those finished runs
- **Window:** report both "per successful run" and "per attempted run" (denominator =
  all finished runs regardless of outcome) — a low "per success" number can quietly hide
  a high failure rate if you don't also show the all-attempts version
- **Excludes:** in-flight runs (cost isn't final yet); use median, not mean, as the
  headline number, and show the mean separately — one very expensive run should not be
  allowed to silently move the number everyone looks at (see Section 5)

### Tokens burned
- **Definition:** sum of `tokens_in + tokens_out` from `model_turn` rows, split into at
  least: fresh input tokens, cached input tokens (cheaper — don't merge with fresh),
  output tokens, and reasoning/thinking tokens if the model produces them separately
- **Window:** daily, rolled up to weekly/monthly for billing-style views
- **Excludes:** nothing — this is a raw usage count, not a judgment call. Report it
  separately from cost, because price-per-token can change over time and you want to be
  able to see "we used more tokens" versus "tokens got cheaper/pricier" as two different
  stories.

### Failure rate by cause
- **Numerator:** count of runs with `end_status = 'failed'`, grouped by `end_reason` /
  `error_type`
- **Denominator:** all runs with a terminal state in the window (same as success rate)
- **Window:** same rolling 7/30-day pair
- **Excludes:** same in-flight and early-cancel exclusions as success rate
- **Note:** keep the cause taxonomy small and mutually exclusive (model error, tool
  error, timeout, policy block, infra error, user cancelled) — a taxonomy with fifty
  overlapping causes makes this chart useless

### Policy flags
- **Definition:** count of `policy_check` events with `decision` in (block, warn,
  require_approval), grouped by `policy_name`
- **Denominator options depending on question:** per 100 runs (rate), or as a share of
  all policy checks performed (what fraction of checks actually fire), or as absolute
  count trended over time (is this getting better or worse)
- **Window:** daily, both trended and as a rolling rate
- **Excludes:** nothing hidden, but distinguish `block` (agent was stopped) from `warn`
  (agent continued, someone should look) — merging them hides whether the guardrail is
  actually stopping anything

### Latency: a model turn vs. a whole run
These are two different measurements and must be labeled as such on the dashboard —
"latency" alone is ambiguous:
- **Turn latency:** `latency_ms` from each `model_turn` row — how long a single model
  reply took. p50/p95/p99 computed across all turns in the window.
- **Run latency:** `duration_ms` from each `run_finished` row — wall-clock time for the
  whole task, including every turn, every tool call, and any time the agent spent
  waiting on a slow tool or an external system. p50/p95/p99 computed across all
  finished runs in the window.
- **Window:** rolling 24-hour and rolling 7-day, bucketed hourly or daily for trend
  charts
- **Excludes:** in-flight runs (no duration yet); runs that failed due to
  infra/timeout should be shown separately, not blended into "normal" latency, because
  a timeout artificially caps duration at the timeout value and drags percentiles down
  in a misleading way (this looks like "we got faster" when actually more runs just
  gave up sooner)

---

## 4. Computing percentiles honestly

**The core rule: percentiles cannot be averaged.** A percentile is a position in a
sorted list, not a quantity — averaging five different p99 numbers from five different
time buckets, or five different servers, does not give you the true overall p99. It can
be badly wrong in either direction. A worked example from the SRE (site reliability
engineering) literature: averaging five per-host p99 values reported 550ms, while the
true fleet-wide p99, computed correctly, was 1000ms — the average understated the real
tail by almost 2x.
Source: https://clickhouse.com/resources/engineering/percentiles-vs-averages ,
https://www.elastic.co/blog/averages-can-dangerous-use-percentile

**What actually works — two approaches:**

1. **Exact, on raw rows, inside one query.** Standard SQL has a built-in function for
   this: `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)` computed over the
   raw rows for the window you care about, in one pass, with no intermediate averaging
   step. This is exact and simple, and it's the right choice as long as the row count
   per query stays in the millions, not billions.
   Source: https://www.tigerdata.com/learn/understanding-percentile_cont-and-percentile_disc

2. **Approximate, from a compressed summary, for daily rollup tables.** For a
   pre-aggregated daily table (Section 2) you don't want to keep every raw row forever.
   Instead of storing a plain average per day, store a small compressed sketch of the
   whole distribution for that day — a data structure like **t-digest** or
   **HdrHistogram** that can be merged across days or hours and still answer "what's
   the p95" afterward, accurately, without keeping every original number. This is how
   Elasticsearch, Prometheus, and most monitoring systems do it under the hood.
   t-digest source: https://github.com/tdunning/t-digest ;
   used in production timeseries systems, e.g.
   https://github.com/timescale/timescaledb-toolkit/blob/main/docs/percentile_approximation.md

**The cheap approximation, if you don't want to add a sketch library:** compute exact
percentiles per hour (small enough row count to be fast and exact), and when you need a
daily or weekly number, re-run the exact percentile query over the raw rows for that
whole window rather than trying to combine the hourly percentile numbers
mathematically — because, again, you cannot correctly combine percentiles after the
fact. If raw-row volume makes that too slow, that's the point where a proper sketch
(t-digest/HdrHistogram) earns its complexity.

**Practical recommendation:** keep raw `model_turn` and `run_finished` rows for at
least 30–90 days so exact percentiles are always available for recent data; for
anything older, store a t-digest sketch per day per dimension (per team, per model) so
historical trend charts stay accurate without keeping every row forever.

---

## 5. Traps

- **Survivorship bias.** If you only look at "active users" you only ever see the people
  who stuck around — the ones who tried it once and never came back are invisible, and
  everything looks better than it is. Fix: always report adoption against the full
  licensed population, not just against people who already showed up. A tell that this
  bias has crept in: if the "active user" count is shrinking but every quality metric is
  improving, the improvement may just mean the frustrated users left, not that the
  product got better.
  Source: https://prachub.com/resources/understanding-survivorship-bias-a-hidden-trap-for-data-scientists

- **Denominator choice: active users vs. licensed seats.** Same failure mode as above,
  stated as a design decision: decide up front which denominator each metric uses, and
  never let a chart silently switch between them. "Adoption" needs licensed seats in the
  denominator (or it can't measure adoption at all — it would only measure retention of
  people who already adopted). "Engagement quality among users" can legitimately use
  active users as the denominator.

- **Time zones.** "Daily active users" is meaningless without agreeing what a day is.
  An org with engineers in three time zones will get different DAU numbers depending on
  whether "day" is anchored to UTC or to each person's local day. Recommendation: store
  every event in UTC plus the actor's local offset at event time (already in the shared
  tags in Section 1), pick one anchor (UTC midnight is the least surprising default for
  an org-wide dashboard), and say so on the chart. Never silently mix local-time and
  UTC-time day boundaries across different charts on the same dashboard.

- **Partial / in-flight runs.** A run that hasn't reached `run_finished` yet has no
  `duration_ms`, no final `cost_usd`, and no `end_status`. If a query for "average run
  duration today" naively includes in-flight runs by treating their current elapsed
  time as the duration, it understates true duration (a run that will take an hour
  looks like it took 5 minutes if you check 5 minutes in). Fix: every run-level metric
  query filters to `run_finished IS NOT NULL` explicitly, and the dashboard separately
  shows a live "runs in progress" count so in-flight work isn't just dropped silently.

- **Retries counted as new runs.** If an agent (or a person) retries a failed task and
  each attempt gets its own `run_id` with no link between them, then "success rate"
  looks artificially low (each failed attempt counts against it) and "runs per day"
  looks artificially high (one task inflates into three rows). Fix: the
  `parent_run_id` field from Section 1 — always report both first-attempt and
  eventual-outcome success rates (Section 3), and when counting "tasks completed,"
  collapse a retry chain to one task, not three runs.

- **One very expensive run skewing a mean.** Cost and token distributions are typically
  "long-tailed" — most runs are cheap, a few are very expensive, and those few can pull
  a plain average far from what a typical run actually costs. Use the median as the
  headline number for "typical cost," and show the mean and the max alongside it so an
  outlier is visible rather than hidden inside an average that quietly absorbed it.

- **Small-team noise.** A 3-person team's success rate can swing from 100% to 67% with
  a single failed run — that's not a real change in quality, it's just small-sample
  noise. A 40-person team's success rate barely moves per run. If both are shown on the
  same leaderboard with no adjustment, small teams will unfairly dominate both the top
  and bottom of the ranking purely from luck. The standard fix from research on
  comparing institutions of different sizes is a "funnel plot": instead of ranking teams
  by their raw metric, plot each team's metric against its run count, and draw
  confidence bands that get narrower as run count grows. A team only stands out if it
  falls outside the band for its size — meaning what looks unusual actually is unusual,
  not just small and noisy. Source:
  https://arxiv.org/pdf/1810.12719 (funnel plots for comparing institutions of different sizes)

- **Goodhart's law: people change behavior once they know a number is watched.** "When
  a measure becomes a target, it stops being a good measure." If engineers know "success
  rate" is on a leaderboard, some will start giving the agent only easy tasks, or
  marking ambiguous outcomes as "success" to protect the number, rather than actually
  getting more done. Practical mitigations: don't publish single-metric team
  leaderboards; always pair a volume metric with a quality metric so gaming one hurts
  the other (e.g., pairing "runs per week" with "success rate" makes rubber-stamping
  easy tasks show up as a drop in typical task complexity); and involve the engineers
  being measured in choosing and revising the metrics, since the people closest to the
  work are the first to spot a gameable definition.
  Source: https://jellyfish.co/blog/goodharts-law-in-software-engineering-and-how-to-avoid-gaming-your-metrics/

---

## 6. Comparability: a 3-person team vs. a 40-person team

There is no single fix, only tradeoffs. Three approaches, in increasing order of
sophistication:

1. **Per-person normalization.** Divide totals by headcount (runs per engineer, cost
   per engineer). Simple and transparent. Downside: it hides the small-sample noise
   problem above — a 3-person team's per-person rate is still wildly noisy, it's just
   noisy on a per-person basis instead of a per-team basis.

2. **Rate metrics instead of count metrics wherever possible.** Prefer "success rate"
   (a percentage) over "number of successful runs" (a count) for cross-team comparison,
   since rates are somewhat size-independent — but note this only removes the size bias
   in the *center* of the number, not in its *reliability*. A 90% success rate from 5
   runs and a 90% success rate from 500 runs are not equally trustworthy, even though
   they're the same number.

3. **Uncertainty-aware comparison (funnel plots or confidence intervals).** Show every
   team's rate metric together with a confidence interval or a funnel-plot band sized to
   that team's run count, so a viewer can tell "this team is genuinely different" from
   "this team is small and this is just noise." This is the only approach of the three
   that actually solves the small-team-noise trap, and it's standard practice in fields
   that regularly compare institutions of very different sizes (hospitals, universities,
   sports teams). Downside: it's more work to build and it's a less intuitive chart for
   a general audience than a simple bar or leaderboard, so it needs a one-line
   explanation on the dashboard itself ("bands show the range of results expected from
   luck alone, given how many runs this team has done").
   Source: https://arxiv.org/pdf/1810.12664 (funnel plots vs. rankings for
   institution-level comparison)

Recommendation: default every team-comparison view to rate metrics with a visible run
count next to them, and add confidence bands (option 3) to any view explicitly framed
as a ranking or leaderboard — rankings are exactly where the small-team-noise trap does
the most damage, because someone will act on the ranking.

---

## Sources

- Percentiles and averages: https://clickhouse.com/resources/engineering/percentiles-vs-averages , https://www.elastic.co/blog/averages-can-dangerous-use-percentile , https://danluu.com/latency-pitfalls/
- SQL percentile computation: https://www.tigerdata.com/learn/understanding-percentile_cont-and-percentile_disc , https://github.com/timescale/timescaledb-toolkit/blob/main/docs/percentile_approximation.md
- t-digest / streaming percentile sketches: https://github.com/tdunning/t-digest , https://www.sciencedirect.com/science/article/pii/S2665963820300403
- OpenTelemetry GenAI semantic conventions (event/metric field names): https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md , https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-events.md , https://opentelemetry.io/blog/2026/genai-observability/
- DORA metrics (deployment frequency, change failure rate, lead time, recovery time): https://dora.dev/guides/dora-metrics/ , https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance
- DORA metrics adapted for AI-assisted teams: https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025 , https://plandek.com/blog/how-to-measure-dora-metrics-in-the-age-of-ai-2026
- Usage-based billing / metering event design: https://openmeter.io/docs/metering/guides/best-practices , https://docs.stripe.com/api/billing/meter-event
- Active users / cohort definitions: https://amplitude.com/glossary/terms/monthly-active-users , https://docs.mixpanel.com/guides/strategic-playbooks/guide-to-product-analytics/get-to-know-your-users
- Survivorship bias and denominator choice: https://prachub.com/resources/understanding-survivorship-bias-a-hidden-trap-for-data-scientists , https://hackernoon.com/is-your-data-biased-how-to-overcome-survivorship-bias-9o6g33qh
- Goodhart's law in engineering metrics: https://jellyfish.co/blog/goodharts-law-in-software-engineering-and-how-to-avoid-gaming-your-metrics/
- Funnel plots for comparing groups of different sizes: https://arxiv.org/pdf/1810.12664 , https://arxiv.org/pdf/1810.12719
