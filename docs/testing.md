# Testing

This is how we prove the dashboard tells the truth. The numbers in `docs/metrics.md` are not
just formulas — each one has a specific way of going wrong, and most of those ways have already
tricked a real dashboard somewhere. Every trap listed in metrics.md gets a test named after it.
That's the point of this document: not "how do we get good coverage" but "how do we make sure
nobody can quietly break a number without a test turning red."

## 0. Where a test file lives

| Kind | What it covers | Where |
|---|---|---|
| Unit | Business logic with fake dependencies. No database. | beside the file, `thing.test.ts` next to `thing.ts` |
| Integration | Repositories against a real temporary SQLite file, built from the real migrations | beside the file |
| End to end | A whole path through the running app — real HTTP requests, or a screen driven for real | `apps/<app>/test/` |

**The one exception:** `apps/api/src/db/schema.test.ts` covers `migrations/*.sql`, which has no
`.ts` file to sit beside. It lives with `migrate.ts`, the code that builds that schema, and its
first line says what it covers. Putting TypeScript inside the folder of SQL files would be worse.

A test file covers **one** source file and is named after it. A single test file covering four
source files hides which of them is actually checked.

## 1. Each layer, tested its own way

`docs/architecture.md` draws one line through the code: controller, then service, then
repository, then the database. Each layer gets a different kind of test, because each layer is
built to be tested a different way.

**Services get a fake repository and no database at all.** A service is handed whatever it needs
through its constructor — `new MetricsService(runRepo, teamRepo)`. It never opens a database
connection itself; it only ever calls methods on whatever object it was handed. So a test can
build a small object that has the same methods as a real repository but just returns whatever
rows the test wrote down by hand — a fake repository that returns whatever the test tells it to
— and hand that to the service instead of a real one. No SQLite file, no disk, nothing slow.
This is where almost all the metric tests below live, because it's the cheapest way to try a
strange combination of rows (a run still in progress, a task with three failed attempts, a
dormant seat) without having to actually insert them into a database first.

**Repositories get a real, temporary SQLite file.** A repository's whole job is turning a
question into SQL and turning rows back into plain objects. The only honest way to check that is
to run it against a real database. Each repository test creates a fresh, empty SQLite file in a
throwaway folder, runs every migration file against it in the same order the real service would
(0001, 0002, and so on), puts a handful of rows in by hand, calls the repository method being
tested, checks what comes back, then deletes the file. Running the real migration files matters:
if a test built its own copy of the schema instead, a broken migration could pass every test and
still break the real database.

**Controllers get a real HTTP request.** A controller reads a request, checks it with Zod, calls
a service, and shapes a reply — the only honest way to test that is to actually send it a request
over HTTP, the same way the browser will. The test starts the real Bun server on a free port,
sends it a request with `fetch()`, and checks the status code and the JSON body that comes back.
The controller test hands the controller a fake service (same idea as above) so it isn't
re-checking the maths — only the request and the reply.

Put together: a bug in the maths shows up in a service test. A bug in a query shows up in a
repository test. A bug in what a route accepts or returns shows up in a controller test. Nobody
has to guess which layer broke.

## 2. The metric tests — the heart of this

Every number on the dashboard is defined once, in `docs/metrics.md`. Below, for each one, is the
specific test that pins its definition down and the mistake it would catch if someone got it
wrong. Unless noted, these are service tests: a fake repository hands back a small, hand-built
set of rows, and the test checks what the service works out from them.

### Group 1 — Adoption

| Number | The test | The trap it catches |
|---|---|---|
| Adoption rate | An org has 10 licensed seats. Only 4 engineers have ever run anything, and 3 of those ran something in the last 7 days. The 7-day adoption rate must come out to 3 ÷ 10, not 3 ÷ 4. | Dividing by people who tried it, not by seats, makes a rollout that mostly failed look fine. |
| Sticking rate | Same fixture as above, same 4 engineers who've ever run anything, same 3 active in the last week. Sticking rate must come out to 3 ÷ 4 — a different number from adoption rate, from the exact same rows. | Adoption rate and sticking rate share numerators but use different bottoms (seats vs. ever-active). Mixing them up silently swaps one question for another. |
| Depth of use | Six engineers with run counts of 0, 1, 4, 5, 19, 20 in the last 30 days land in dormant, light, light, regular, regular, deep — every boundary tested on the number right at the edge. A seventh engineer with only 2 runs total, but two of them running at the same time, still lands in deep. | Off-by-one on a bucket edge (is 5 "regular" or "light"?) quietly moves people between buckets every month. Running several agents at once must count as deep even with a low total. |

### Group 2 — Outcome

| Number | The test | The trap it catches |
|---|---|---|
| First-try vs. eventual success rate, on one fixture | Five tasks: three succeed on the first run. Two fail once, then succeed on a second run. That's 7 runs total, 5 of which finished successfully. First-try success rate = 5 ÷ 7 (successful runs over all runs that reached an end) ≈ 71%. Eventual success rate = 5 ÷ 5 (tasks with an eventual win over all tasks) = 100%. Both numbers come from the same 7 rows, and both are right. | Treating these as the same question, or computing both with the same denominator, erases the exact gap ("the agent works but wastes money getting there") the two numbers exist to show. |
| Finished tasks / cost per finished task | One task made of three runs: two failed attempts costing 200 cents and 300 cents, then a third that succeeds and costs 100 cents. Finished tasks = 1, not 3. Cost per finished task's top = 600 cents (all three), not 100 (just the winner). | Counting a retry chain as three tasks inflates the finished count and hides the real cost; counting only the winning run's cost hides the exact waste the number is meant to expose. |
| A retry chain stays flat | Insert a first attempt, then a retry pointing at it, then a third attempt pointing at the **second** run instead of the first. The database must refuse the third insert. Then insert it pointing at the first run and check the chain totals as one task. | Verified in SQLite: with the mis-linked row allowed in, one task costing 1300 cents was reported as two separate tasks costing 600 and 700. Nothing errors and nothing looks odd on screen — finished-task count goes up, cost per task goes down, and every money and outcome number is quietly wrong. The foreign key alone does not catch this, so a trigger does. |
| Cancelled-early runs | A run cancelled 3 seconds in, before the agent did anything. It is not counted in the numerator or the bottom of either success rate, but it does show up in its own "cancelled" count. | A run that was never really tried shouldn't drag success rate down (a loss) or prop it up (excluded entirely and forgotten). It has to be visible somewhere so it doesn't quietly disappear. |
| Runs still in progress | A run with no end time yet. It's excluded from success rate, cost per finished task, and every percentile, but shows up in a separate live "in progress" count. | An unfinished run has no final cost or duration — folding it into a finished-run number either breaks the maths or silently double-counts it later when it does finish. |
| What came out / merged PRs | Five pull requests produced, three of them actually merged. "What came out" reports 5 pull requests; the honest number reports 3 merged. | Counting opened PRs as delivered value would call a rollout a win even when nobody used what it produced. |
| Rework rate | Three merged changes, all merged on day 0. One reverted on day 10 (inside the 14-day window — counts). One reverted on day 20 (outside — doesn't count). One never touched. Rework rate = 1 ÷ 3, not 2 ÷ 3. | Getting the 14-day window wrong either hides real damage (window too short) or blames changes that were long since accepted (window too long, or no window at all). |

### Group 3 — Money

| Number | The test | The trap it catches |
|---|---|---|
| Cost of one run — cache pricing | One turn with fresh input tokens, cache write tokens, and cache read tokens, all at the same base input price. The test checks the cache-read tokens are priced at a tenth of the fresh rate and the cache-write tokens at the write rate — not lumped in with fresh tokens at full price. | Pricing cached tokens like fresh ones overstates cost by roughly 10x on exactly the tokens that were cheap because they were reused. |
| Cost of one run — thinking tokens | A turn with a small visible answer but a long thinking pass. Thinking tokens are priced at the output rate and shown in their own column, separately from the visible output tokens. | Folding thinking tokens into a general "output" bucket, or dropping them, hides a cost that can be several times the visible answer. |
| Cost of one run — tool time | A run whose turns cost some cents and whose tool calls carry their own cents. The total is the turn costs plus the tool call costs, with no hourly rate involved anywhere. A free tool contributes zero. | The earlier design worked tool cost out from seconds and an hourly rate we would have had to keep in step with whoever actually bills for the tool. Each call now stores what it cost. A test still describing the old rate formula would push someone into rebuilding it. |
| Cost of one run — rounding happens once | Price a turn whose five parts (fresh input, cached input, cache write, output, thinking) each land on a fraction of a cent. The total is rounded once at the end, not five times on the way. | Rounding each part separately can drift a couple of cents per turn, and a run has many turns. Rounding once keeps the error under half a cent no matter how many parts there are. |
| Cost of one run — prices change over time | A turn priced under an old rate, followed by a price table update. Re-fetching the old turn's cost afterward must return the same number as before the price changed. | A turn should be priced at the rate in effect when it ran. If cost is computed live from today's price table instead of the rate on the day the turn happened, historical costs quietly rewrite themselves every time prices change. |
| Cost per finished task — median and average shown together | Nine runs costing 100 cents each, and one runaway run costing 10,000 cents, all inside finished tasks. The median must land at 100 cents; the average must land far higher; both are reported, side by side. | An average alone lets one runaway task make every other task look about as expensive as it, hiding exactly the outlier the number exists to surface. |
| Money never drifts through a float | Add up a long list of run costs, each a whole number of cents (for example, three runs of 33, 34, and 33 cents, repeated many times, in different orders). The total must come out exactly the same integer regardless of the order added. | Storing or adding money as a float lets rounding drift accumulate — the same set of runs could total a different number of cents depending on the order they were summed, which is not something a person can be shown with a straight face. |
| Budget — burn pace | A team 10 days into a 30-day month has spent 80% of its budget. Pace = spent ÷ share of month gone = 0.80 ÷ (10/30) = 2.4 — well past "on track." The same 80% spent on day 28 gives a pace of about 0.86 — basically on track. Both computed from the same "80% spent," different pace. | A bar showing "80% spent" looks the same on day 10 and day 28. Only the pace number tells them apart, and that's the number the team actually needs. |
| Budget — warning line vs. stop line | A team exactly at its warning line (not a cent over) is flagged as warned, not stopped. A team exactly at its stop line is flagged as stopped. A team one cent under either line is flagged as neither. | Getting a boundary wrong either nags a team that's fine or fails to flag one that's actually over — and a stop line is supposed to be rare enough that it means something. |

### Group 4 — Reliability

| Number | The test | The trap it catches |
|---|---|---|
| Failure cause → whose-problem bucket | Every cause in the table in metrics.md (missing permission, dependency install failed, ran out of context room, model refused, and so on) is checked once, confirming it lands in exactly one of org setup, platform, or task — and that "person cancelled" lands in neither. | If a cause is missing from the mapping, or lands in two buckets, the failure chart silently loses runs or double-counts them, and the "whose problem" split — the entire point of the chart — stops adding up. |
| Quiet failures | A run marked as succeeded, but separately flagged as a quiet failure. It still counts toward the plain success rate (it did report success) and it also increments its own, separate quiet-failure count. | If a quiet failure secretly subtracted from success rate, the two numbers on screen wouldn't match what a person clicking into the run sees. Counting it twice in different places is exactly what "flagged with its own marker, counted on its own" means — not "quietly correct the other number." |
| Retry rate | Four tasks: one has a single run, three have two or more runs each. Retry rate = 3 ÷ 4. | Counting retried runs instead of retried tasks overstates or understates the rate depending on how many attempts each retried task took. |
| Time before giving up | A run that failed after 45 minutes, next to a run that succeeded after 2 minutes and one still in progress. Only the failed run's duration counts toward this number. | Mixing in successful or unfinished runs hides the slow-motion failures — the ones burning budget for an hour before anyone notices — inside numbers about runs that were never a problem. |

### Group 5 — Rules

| Number | The test | The trap it catches |
|---|---|---|
| Flags ranked by "new for this team" | Team A has seen 50 low-severity flags of one kind before today. Team B sees a kind of flag it has never had, once, today. Team B's flag ranks above Team A's, even though Team A has far more flags overall. | Ranking by raw count buries the one thing worth noticing — a team's first-ever flag of a new kind — under teams that just make a lot of noise doing the same thing they always do. |
| Dismissed-as-expected rate | A flag kind triggered 20 times, dismissed as "expected" 18 of those times. The rate comes out to 18 ÷ 20, tracked per kind. | Without this number, a rule that's wrong 90% of the time looks identical to one that's rarely wrong — both just show up as "20 flags" on a count-only chart. |
| Severity keeps its own lane | One flag of each severity (low, medium, high) in the same batch. All three come back distinct — none gets merged into another on the way through. | Collapsing severity loses the one column the doc says matters most for a high flag: "tell a person now." |

### Speed

| Number | The test | The trap it catches |
|---|---|---|
| Turn time vs. run time stay separate | One run made of 40 short turns. Turn-time p95, computed over the 40 turns, comes out low. Run-time p95, computed over the one run's total wall time, comes out high. Both are shown, and neither is called just "latency." | Blending turns and runs into one "latency" number hides whichever one is actually slow — a run can be slow because of one bad turn, or because of everything in between the turns. |
| Percentiles are never averaged | Two days of turns: day one has 10 turns all at 100ms. Day two has 9 turns at 100ms and one at 2,000ms. Each day's own p95 is roughly 100ms and 2,000ms — average those two daily numbers and you get about 1,050ms. But look at all 20 raw turns together, sorted once: 19 of the 20 are 100ms, so the true p95 across the whole period is 100ms. Ten times off, from averaging two numbers that were each individually correct. | This is the exact mistake described in metrics.md — averaging per-day (or per-host) percentiles instead of recomputing over every raw row understates or overstates the tail by a wide margin, and looks perfectly reasonable until you check it against the raw rows. |
| Timeouts charted apart | Five runs: three finish normally, two get cut off at the timeout limit. Run-time p95 computed over just the three normal runs differs from a p95 that includes the two capped ones, and the timeout count is shown as its own number, not folded into the percentile. | A timeout caps a run's duration at the limit. Blend those capped durations into the percentile and it looks like things got faster, when what actually happened is more runs gave up early. |

### Comparing teams of different sizes

| Number | The test | The trap it catches |
|---|---|---|
| Rate always shown with its run count | A team with a 90% success rate off 5 runs and a team with a 90% success rate off 500 runs. Both display the same rate, but each carries its own run count next to it — the run count is never dropped from either the screen or the underlying data returned. | A bare percentage makes a 5-run team and a 500-run team look like the same claim, when one could flip entirely on a single different outcome and the other basically can't. |
| Band width shrinks as run count grows | Two teams with the same underlying success rate but very different run counts (say, 5 runs and 500 runs). The small team's band comes out wider than the big team's. A team sitting inside its own band is not flagged; one sitting outside its own band is. | The exact statistical formula for the band is a service-level decision, not fixed by metrics.md, so this test doesn't pin down a formula — it pins down the two properties any correct formula must have: bands shrink as runs pile up, and "flagged" means "outside your own band," never "below some fixed number." |

> `ponytail:` the team-size band uses whatever confidence-interval style formula the service
> author picks (Wilson score interval and a simple normal approximation are both fine at our
> row counts). The test suite checks the shape of the answer, not one specific formula, so
> swapping the formula later doesn't mean rewriting the tests.

## 3. Acceptance tests — one for each screen, in plain English

These are written so anyone on the team — not just an engineer — can walk through the running
app and check each box by hand, or automate the same steps later. Given / when / then, one
scenario per row.

### Org screen (the CTO's screen — everything, month over month)

- **Given** a run still in progress somewhere in the org, **when** the org screen loads, **then**
  that run is not counted in the finished-run success rate, and a separate "in progress" count is
  shown so it isn't just missing.
- **Given** the "hours saved per task" and "cost of an engineer hour" boxes at the top of the
  screen, **when** a person types a different number into either box, **then** the net value
  number below recalculates right away, without reloading the page.
- **Given** a team of 3 people and a team of 40 people with the same success rate, **when** they
  appear on the same chart, **then** each one's run count is printed next to its rate.
- **Given** finished tasks and rework rate for the month, **when** the org screen loads,
  **then** the two numbers sit next to each other — never one without the other.

### Team screen (the manager's screen — one team, this week, against budget)

- **Given** a team that has spent past its stop line, **when** its team screen loads, **then**
  the budget shows a stopped state, not just a bar past 100%.
- **Given** two teams both at 80% of budget spent, one on day 10 of the month and one on day 28,
  **when** their pace is shown, **then** the two look clearly different from each other, not like
  the same situation.
- **Given** a team seeing a kind of policy flag it has never triggered before, **when** its team
  screen loads, **then** that flag is shown above older flag kinds the team triggers often, even
  if the older kind has far more occurrences this week.
- **Given** a team in its first weeks of using the product, **when** its failure-by-cause chart
  loads, **then** org-setup causes make up most of its failures, and the screen says plainly that
  these are fixable this afternoon.

### Engineer screen (one person's own page)

- **Given** an engineer's full run history, **when** they open their own page, **then** every
  comparison is against their own past — no teammate's name or number appears anywhere on the
  page.
- **Given** an engineer who moved from one team to another partway through the month, **when**
  looking at their old team's historical numbers, **then** the runs they made while on that team
  are still counted there, unchanged by the move.

### Run screen (one task, every attempt)

- **Given** a task that took three runs to succeed, **when** its run screen loads, **then** all
  three attempts are visible — the two failed ones and the one that worked — along with every
  turn and tool call inside each, and the combined cost of all three together.
- **Given** a run flagged as a quiet failure, **when** its run screen loads, **then** both the
  "succeeded" status and the quiet-failure marker are shown together — neither one hides the
  other.

## 4. What we deliberately do not test, and why

- **No pixel-by-pixel chart tests.** Nobody reads a chart by checking that a bar is exactly 214
  pixels tall. A human looks at the chart once and confirms it reads clearly; the numbers feeding
  it are what the tests pin down.
- **No matching exact wording or punctuation of on-screen text**, beyond the acceptance
  scenarios above. A test that breaks because someone changed a comma is a test nobody wants to
  fix, and it teaches people to stop trusting red test runs.
- **No whole-response snapshot tests.** Saving an entire JSON reply and diffing it byte for byte
  breaks every time an unrelated field is added, for no real reason. Tests check the specific
  numbers and fields the scenario is actually about.
- **No load or speed testing of the service itself.** This runs off one SQLite file with a small
  amount of made-up data and one person looking at it at a time. There is no real traffic to
  simulate.
- **No login or permission tests.** There is no login. Nothing to test.
- **No testing against real git, GitHub, or a ticket system.** None of those exist here — the
  seed data stands in for all of it, on purpose (see `docs/product-brief.md`).
- **No chasing a coverage percentage.** A test suite that has a named test for every trap in
  `docs/metrics.md` is what "well tested" means here. A high coverage number that skips the
  traps above is worth less than a lower one that catches all of them.
- **No treating the seed data's specific story as a requirement.** The seed data exists to make
  the screens look real (see `docs/seed-data.md`), not to be a spec. Tests build their own small,
  hand-written rows so they don't break every time someone tunes the seed script's numbers. The
  one exception: a small smoke check that loads the seeded database and confirms every screen's
  endpoint returns something without error — that one does use the real seed data, because its
  whole job is proving the seed data actually loads.

## 5. Running it, and what "done" means

Run everything with:

```
bun test
```

This runs every service test (fake repositories, no database), every repository test (a fresh
temporary SQLite file per test, built from the real migration files), and every controller test
(a real HTTP server on a free port). Nothing needs to be started by hand first.

A piece of work is done when:

1. Every rule it touches from `docs/metrics.md` has a test whose name says which trap it defends
   against — not just "works," but "does not count a retry chain as three tasks," and so on.
2. `bun test` passes clean. No skipped test without a comment saying why.
3. Any new endpoint has a controller test that sends it both a good request and a bad one, and
   checks the status code and body of each.
4. Any new repository method is tested against a real temporary SQLite file built from the actual
   migration files — never a hand-copied schema.
5. Any new migration is forward-only, and running the whole suite against a brand-new, empty
   database still works end to end.
6. Any acceptance scenario for a screen that was touched has been walked through by hand and
   checked off.
7. Anything deliberately left untested or simplified has a `ponytail:` comment next to it, saying
   what the shortcut is and what the real fix would look like.
