# Screens

Four screens, one drill path: **Org → Team → Engineer → Run.** Each answers one question.
Wireframes for all four live in `artifacts/wireframes/` — open `index.html` straight from disk.

---

# Shared parts of every screen

## The date range picker

All of this data is bounded by dates, so the range is a control, not a caption. It sits at the
top right of the page head on **org, team, and engineer**.

Three preset buttons (7d / 30d / 90d) and two native date boxes. Presets cover the common ask in
one click; the boxes cover everything else. Each screen opens on the preset that matches what it
is for — org on 30d, team on 7d because it is the this-week screen, engineer on 90d because its
trends run eight weeks.

It is a plain `<input type="date">`. The browser already has a calendar, a keyboard path, and a
screen reader path, all of which a hand-built one would have to reinvent worse.

Under it, one line: **days run midnight to midnight UTC.** Every screen says the same thing, in
the same place, because a day meaning different things on different charts is one of the easier
ways to make a whole dashboard wrong.

**The run detail screen has no picker, on purpose.** One run happened at one fixed moment — a
range over it means nothing. It shows an exact timestamp in the same slot, with a link to that
day on the team page. The contents page has none either.

## Numbers the picker does not move

Not everything follows the date range. Adoption is defined on rolling 7- and 30-day windows
(see `docs/metrics.md` Group 1), so it stays put when the picker changes. Success rate and
failure rate do the same — both are always shown as a 7-day figure next to a 30-day one,
computed fresh from "now" (or from `to`, if a custom range end was picked), never from `from`.
Speed percentiles are **not** in this group — they follow the plain `from`/`to` range like every
other non-fixed number (see `docs/api.md` section 2 and `docs/metrics.md`'s Speed section: "for
the period asked for"). An earlier draft of this section grouped speed in with the fixed-window
numbers; that was wrong and is corrected here.

**Say so on the card.** A number that ignores the control sitting directly above it, without
saying it ignores it, is worse than one that is simply missing — the reader assumes it responded
and reads it as an answer to a question it never heard. Each of these carries its window in its
own label ("last 30 days"), so the fixed window is visible next to the number rather than implied
by the picker.

## Emoji, used as words

An emoji **replaces** a word or a coloured dot — it never sits decoratively beside the word it
stands for, never appears inside a big number, and never more than one to a label. The vocabulary
is fixed so the same mark means the same thing on all four screens.

| | Means | | Means |
|---|---|---|---|
| 💰 | money, spend | 🔒 | org setup problem |
| ✅ | succeeded | ⚙️ | platform problem |
| ❌ | failed | 🧩 | task problem |
| 🔁 | another attempt | ⚠️ | warning line |
| ⏱️ | time, speed | 🛑 | stop line |
| 🚩 | rule flag | 🔴 🟠 ⚪ | flag severity |
| 🚀 🔧 🌱 💤 | deep, regular, light, dormant | 🔀 💾 📄 📊 | pull request, commit, file, report |

The point is fewer words on screen, not more colour. If an emoji does not remove a word, it does
not go in.

**This vocabulary is for running text, not for marks drawn on a chart.** ⚠️ and 🛑 stand for
"warning line" and "stop line" next to a word, in a pill, or in a sentence — at the size a chart
actually renders a glyph, it turns to mush no reader can identify. Wherever a warning or stop line
is a mark inside a chart (a bar's threshold marker, a reference line), it's a coloured rule instead
— amber for warning, red for stop — with a short text label riding along where there's room, per
the colour rules below. Colour and position carry the meaning there; the emoji only carries it in
text.

## Shapes before sentences

If a box is mostly a sentence with a number in it, it should be a shape instead:

| What it is | What it becomes |
|---|---|
| Anything over time | Line chart, or a sparkline where it is small |
| Anything compared across categories | Bar chart, horizontal when the labels are words |
| A list of things with numbers | A real table, numbers right-aligned, a thin bar in the cell showing a share |
| A share of a whole | One stacked bar, not four separate numbers |

**Captions that state a rule stay.** "Not a ranking." "Names only, no scores." "The band is the
range you'd expect from luck alone." "The median leads because one runaway run drags an average."
Those sentences are the product's spine and a chart cannot carry them. What gets cut is any
sentence restating a number already on screen, and any caption whose job a chart now does.

---

# The four screens

## Org overview

**Question it answers:** Is this paying for itself, and is anything going wrong I can't see?

**Who opens it:** CTO / VP Engineering, and the platform or finance owner. Window is month over
month.

**Top to bottom:**

1. **Money spent vs. value returned.** Two editable boxes right at the top — hours saved per
   task, cost of an engineer hour — with the defaults already filled in. Below them, three
   numbers: value returned, money spent, and the net, computed live from whatever is in the
   boxes.
2. **Adoption.** Adoption rate and sticking rate as two stats, plus a single bar split into the
   four use-depth buckets (deep / regular / light / dormant) across all licensed seats.
3. **Outcome.** Success rate (first try and in the end, always paired) with a small trend under
   each. Finished tasks paired with rework rate. What came out (pull requests, commits, files,
   reports, and merged pull requests called out on their own). Runs per week paired with success
   rate.
4. **Money.** Cost per finished task (median headline, average and worst case beside it). Tokens
   used, split into fresh / cached / output / thinking, shown apart from cost. A budget table,
   one row per team, sorted by how far off pace each one is — not by name, not by spend size —
   so the team that most needs a look surfaces first.
5. **Reliability.** Failure rate grouped into org setup / platform / task, each with its causes
   listed underneath. Quiet failures, retry rate, and time-before-giving-up as their own small
   stats beside the group breakdown.
6. **Teams, compared fairly.** A chart plotting each team's success rate against its run count,
   with a shaded band showing the range expected from luck alone. A team is only called out when
   it sits outside the band for its size. Explicitly labelled as not a ranking.
7. **Speed.** Turn time and run time, each as p50 / p95 / p99, with timed-out runs counted apart.
8. **Rules.** A count by severity (low / medium / high), then a list of flags ranked by how new
   they are for the team that got them — not by raw count.

**Chart types, and why:**

| Number | Chart | Why |
|---|---|---|
| Value returned vs. money spent | Two-number comparison + net | It's a subtraction, not a shape — the arithmetic should be visible, not decorated |
| Depth of use | One stacked bar, four segments | It's a full breakdown of every seat into one of four buckets — a stacked bar shows the whole and the split in one look |
| Success rate (first try / in the end) | Paired big numbers, each with a small column trend | Reading them side by side is the whole point; the trend shows whether the gap between them is closing |
| Finished tasks + rework rate | Paired stat card | A volume number must never appear without its quality number touching it |
| Cost per finished task | Horizontal number line, three marked points (median, average, worst) | Costs here are long-tailed; a number line makes the spread between "typical" and "worst" visible at a glance, which three separate boxes would not |
| Tokens used | Stacked bar, four segments | Same shape as depth of use — a decomposition of one total, kept visually apart from the cost numbers |
| Budget burn | Horizontal bar with three markers (day-of-month line, warning line, stop line) | A filled bar alone can't show pace; overlaying where the calendar is against where the spend is makes "ahead of pace" readable without doing math |
| Team comparison | Scatter of rate vs. run count, with a shaded expected-range band | This is the one place a plain bar chart would actively mislead — it would make a 3-run team's 100% and a 600-run team's 91% look equally meaningful |
| Failure causes | Three grouped clusters (org setup / platform / task), causes listed inside each | Whose-problem is the number that matters; grouping by owner instead of by raw cause count is what makes the chart actionable |
| Speed percentiles | Three-number row (p50/p95/p99) with a small trend | Percentiles are positions, not quantities — showing three distinct points is honest, a single average would not be |
| Flags | Ranked list, severity and status shown as pills | A list ranked by "new for this team" surfaces the thing worth acting on; a bare count would bury it under old, already-tolerated noise |

**Clicks to go deeper:** any team name (in the budget table or the comparison chart's legend)
opens that Team page. The breadcrumb at the top is also the nav — it's real navigation, not
decoration.

**Empty:** no runs yet anywhere — "No runs yet. Once engineers start using it, this page fills in
— check back after day one." Every card keeps its layout; numbers just don't render.

**Loading:** cards hold their final size and show a skeleton (grey bars) in place of numbers, so
nothing reflows once data arrives.

**Error:** failures are scoped per section, not whole-page. "Couldn't load this section. Retry —
the rest of the page still works." One broken chart never takes the rest of the screen down with
it.

---

## Team page

**Question it answers:** Is my team getting value, is anything stuck or breaking, am I about to
blow my budget?

**Who opens it:** Engineering manager. Window is this week, against the team's monthly budget.

**Top to bottom:**

1. **Budget**, first and biggest — the one thing on this page a manager can act on. Spent
   against the limit, a burn-pace bar (day-of-month marker against percent-used, warning and stop
   lines), and a plain-language projection: "at this pace, month-end spend will land at $X" —
   with the actual number of days that would blow past the stop line if it's heading there.
2. **Outcome, this week.** Runs paired with success rate (first try and in the end). Finished
   tasks paired with rework rate, with an explicit comparison to the org average so a manager
   knows if their team's number is normal.
3. **Cost per finished task**, same number-line treatment as the org page, scoped to this team.
4. **What broke, whose problem.** Same three-group layout as org, scoped to this team, with a
   plain-language callout when one cause is doing most of the damage ("driven almost entirely by
   one thing").
5. **Rules**, scoped to this team, same "new first" ranking as org.
6. **Team members** — plain names in a simple list, alphabetical, nothing next to them. No
   numbers, no colours, no order that implies comparison. This is the one place the "no roster
   with numbers" rule is most tempting to break, so it's enforced hardest here: a name is a
   link to that person's own page, and that's all it is.

**Chart types:** identical vocabulary to the org page (paired stats, number-line for cost,
grouped bars for failure causes) so a manager who has seen the org page already knows how to read
this one. The budget bar gets extra treatment here — three markers instead of the org table's
single pace pill — because this is the page where a manager needs to act on it directly.

**Clicks to go deeper:** any name in the member list opens that person's Engineer page.

**Empty:** team has run nothing this week — "No runs yet this week," with last week's numbers
kept visible underneath for reference rather than blanking the whole page.

**Loading:** same skeleton pattern as org.

**Error:** scoped per section — losing budget data doesn't take down the outcome or reliability
sections below it.

---

## Engineer page

**Question it answers:** Is this helping me?

**Who opens it:** The engineer themselves, about their own page and nobody else's. A manager can
also open it by clicking a name on the Team page — what they see is identical either way.

**Top to bottom:**

1. **Right now.** Current use-depth bucket (deep / regular / light / dormant) and how long
   they've been in it, plus what bucket they were in before — their own trajectory, never a
   comparison to a teammate's bucket.
2. **Success rate, own trend.** First try and in the end, always paired, each with its own trend
   over the last 8 weeks. A line noting whether the gap between the two is closing.
3. **Finished tasks + rework rate**, this week, paired, each compared only to this person's own
   past average.
4. **Cost per finished task, own trend** — is this person getting more efficient over time.
5. **Recent runs** — a table of their own run history, each row linking to that Run's detail
   page.

**Chart types:** everything here is a trend against the person's own history — a column
sparkline under each stat, never a comparison bar next to a teammate's number. This is the one
screen where "no leaderboard" isn't just a rule about hiding a ranking column — the whole screen
is built so that a ranking is structurally impossible to render, because no other person's number
ever appears on it.

**Clicks to go deeper:** any row in Recent runs opens that Run's detail page.

**Empty:** hasn't run anything yet — "No runs yet. Once they start, their own trend builds up
here — there's nothing to compare them to but themselves."

**Loading:** same skeleton pattern.

**Error:** scoped per section; a broken trend chart doesn't hide the run history table below it.

---

## Run detail

**Question it answers:** What actually happened?

**Who opens it:** Anyone drilling down from a Team, Engineer, or (for finance) a cost outlier on
the Org page. This is the only screen with no fixed audience — it's evidence, not a report.

**Top to bottom:**

1. **Header.** Run ID, outcome pill, the task description in plain words, and who ran it — with
   links back up to their Engineer page and Team page. Started/ended timestamps, duration,
   model, total cost.
2. **This task, start to finish.** If the task took more than one run, every attempt is shown as
   a small chain, oldest to newest, with the failure cause named on any attempt that didn't
   succeed. The cost-per-finished-task number is shown adding up every attempt, not just the
   winning one — the fairness rule from the cost section made visible at the one place a reader
   might otherwise assume only the successful run counted.
3. **What came out** — the actual artifact (pull request, commit, file, or report), and whether
   it was merged.
4. **Rules** — any flag raised during this specific run, with severity and what happened to it.
   Most runs will show nothing here, and showing nothing is the expected, unremarkable state.
5. **Cost breakdown** — a table, one row per token type (fresh input, cache write, cache read,
   output, thinking) with amount, rate, and subtotal, plus a row for tool calls — billed at
   whatever the tool itself charges and stored directly in cents, not run through a rate table
   we'd have to keep in step with someone else's pricing. All rows total to the header number.
6. **Turn by turn** — a numbered list, one entry per turn, each showing what the model did, how
   long it took, and which tools it called.

**Chart types:** this page is the exception to "always a chart" — cost breakdown is a table and
turn-by-turn is a list, because at this level of detail the exact numbers and exact sequence
matter more than their shape. A chart here would compress away the one thing this page exists to
show.

**Clicks to go deeper:** this is the bottom of the drill path — there is nowhere further to go.
Links point back up (engineer, team, other attempts in the same task chain).

**Empty:** not applicable — a Run page is only ever opened for a run that exists.

**Loading / in progress:** a run that hasn't finished yet has no final cost or duration. The page
says so directly — "This run hasn't finished — cost and duration will appear once it ends" — and
still shows turns as they happen, rather than blanking the page until completion.

**Error:** scoped per section — a missing turn log doesn't hide the cost breakdown or outcome
above it.

---

# Colour and layout rules

**Neutral by default.** Every screen is grey, white, and ink-coloured text first. Colour is
spent only where it means something specific — never as decoration, never to make a card "pop."

**Traffic-light colour is semantic, not aesthetic.** Green, amber, and red mean exactly one thing
each, everywhere they appear:

- **Green** — a rate or a status that is where it should be. Used sparingly; the default state
  of most numbers is plain ink, not green, so that green stays meaningful when it does appear.
- **Amber** — a warning line has been crossed, or a number is trending the wrong way and is worth
  watching. Amber is a nudge, not an alarm.
- **Red is reserved for what someone must act on now:** a budget's stop line reached or a
  projection that will cross it, a high-severity flag, or an org-setup failure spike blocking
  people from working. **Red is never used just because a number is lower than another number,
  or because "net" happens to be negative that month.** A below-average result is ink-coloured
  with a plain-language note, not red — red that fires on ordinary variance stops meaning
  anything within a week, which is exactly the failure mode the rest of this document is trying
  to avoid for every other number on these screens.

**One accent colour for "click here."** A single blue is used for every link, every editable
input's border, and nothing else — so "this is interactive" is answered by one consistent colour
across all four screens, never overloaded with a status meaning.

**Every editable field looks editable.** The two hero inputs on the Org page get a visibly
different treatment (bordered, coloured outline) from every read-only number on the page — the
brief's whole point about trust depends on a reader immediately seeing which two numbers are
theirs to change.

**Pair layout, not just pair rules.** Wherever a speed/volume number sits next to a quality
number, they share one card with a vertical divider between them — not two separate cards side by
side. A shared card makes the pairing visually unbreakable even if someone later reorders the
page.

**No colour carries rank.** Bars, dots, and segments that represent categories (use-depth
buckets, token types, failure groups) are shaded in a neutral scale from dark to light. That
scale reflects category order for reading, never a good/bad judgement — the darkest segment is
not "the best" one.

**Dark mode.** Not built into these wireframes (they're deliberately plain and light so the
greyscale hierarchy reads clearly on paper or on any screen), but the rule for the real build is
fixed here: every token above is a variable, light and dark palettes are defined side by side,
and the semantic colours (green/amber/red) keep the same meaning and roughly the same perceived
brightness in both — dark mode is not an excuse to soften red into something that no longer reads
as "act now." Charts and bars keep visible borders in dark mode rather than relying on colour
alone, since several of the semantic colours need to stay distinguishable for anyone with colour
vision deficiency.

**Wide things scroll inside their own box.** A table, a chart, or a code block wider than the
screen gets its own `overflow-x` container. The page body itself must never scroll sideways — when
it does, every other column on the screen goes with it and the whole page becomes unreadable
rather than just the one wide thing.

**Charts shrink differently from hand-drawn SVG.** A hand-rolled chart with a `viewBox` scales its
text down along with everything else; a chart library keeps text at its real size while the plot
area shrinks around it, so labels that fit at full width collide at half. Anything with labels
drawn onto the plot needs a width below which it drops them and leans on the hover tooltip
instead.

**Numbers line up.** Every stat, table column of numbers, and cost breakdown uses tabular
figures, so digits align vertically wherever they're stacked — a reader scanning a column of
costs shouldn't have to work to compare two rows.
