# What buyers see today: AI coding agent dashboards, in plain words

Research pass done as a product owner for a company selling a cloud service that runs AI coding agents. Goal: find out what real products actually show admin/org customers today, and what a buyer needs before they trust the numbers.

## 1. Anthropic — Claude Code

Two separate things, both aimed at org admins:

**Claude Code Analytics dashboard** (console.anthropic.com/claude_code) — a built-in screen, no setup needed. Behind it is the **Claude Code Analytics Admin API** (`/v1/organizations/usage_report/claude_code`), which returns one row per user per day. Exact fields:

- `num_sessions` — how many times someone opened a Claude Code session that day
- `lines_of_code.added` / `lines_of_code.removed` — how much code Claude Code wrote or deleted
- `commits_by_claude_code` — how many git commits Claude Code made
- `pull_requests_by_claude_code` — how many pull requests Claude Code opened
- `edit_tool.accepted/rejected`, `multi_edit_tool.accepted/rejected`, `write_tool.accepted/rejected`, `notebook_edit_tool.accepted/rejected` — for each kind of file change Claude Code proposes, how often the person kept it vs. threw it out
- `tokens.input/output`, `tokens.cache_read/cache_creation`, `estimated_cost.amount` — broken down per model used that day

You can slice all of this by user (`actor`), by whether they're on the pay-as-you-go plan or a subscription (`customer_type`), and by where they ran it (`terminal_type` — VS Code, iTerm, tmux, etc).

**Usage & Cost Admin API** (separate, org-wide, not Claude-Code-specific) — answers "how many tokens did we burn and what did it cost," sliceable by API key, workspace (i.e. team/project), model, and time of day. This is the finance-team view, not the engineering-team view.

What it's for, in Anthropic's own words: proving Claude Code is worth the money ("ROI justification"), finding out which teams get the most value, and building a slide deck for management.

## 2. GitHub Copilot

Two dashboards: an org-level usage dashboard (rolled out earlier in 2026) and a newer "impact" dashboard (July 2026) that tries to answer a harder question than raw usage.

**Usage metrics** (the older, more basic view) — exact fields include:
- `total_engaged_users` — people who actually touched a Copilot feature, not just people with a license
- `daily_active_users` / `weekly_active_users` / `monthly_active_users`
- `loc_suggested_to_add_sum` / `loc_added_sum` — lines suggested vs. lines actually kept
- Acceptance counts broken down by editor, programming language, and model
- `total_created_by_copilot`, `total_merged_created_by_copilot`, `median_minutes_to_merge` — pull requests Copilot opened and how fast they got merged

**Impact dashboard** (the newer one) — this is the interesting one because GitHub clearly heard the complaint that "how many people used it" doesn't tell you anything useful. It buckets every user into one of four groups: Phase 1 (writes code with it), Phase 2 (delegates whole tasks to an agent), Phase 3 (runs multiple agents at once / uses the Copilot coding agent), or Passive (has a license, barely touches it). For each group it shows average pull requests merged per person per month, how fast those PRs get merged, and lines of code per day. Then it compares the "engaged" group against the "licensed but barely using it" group — that comparison is the actual point: it's built to answer "are we getting our money's worth from these seats, and which people do we need to push toward deeper use."

## 3. Cursor

Cursor's dashboard and API are the most detailed of anything reviewed. Highlights:

- **AI Share of Committed Code** — the literal percent of code in a repo that Cursor generated, sliceable per repository and (importantly) filterable to production branches only, so it doesn't count throwaway experiments
- **Agent Edits / Tab Completions** — proposals made vs. accepted vs. rejected, down to individual lines added and removed (`total_lines_suggested`, `total_lines_accepted`, `line_acceptance_ratio`)
- **Repository Insights** — which repos have the most AI-written code, so leaders can see where adoption is real vs. where it's just a demo
- **Conversation Insights** — this is unusual: Cursor tries to classify what people are actually asking the AI to do (new feature vs. bug fix vs. explaining code), how complex the ask was, and how much hand-holding the person gave it. This gets at "is this replacing grunt work or hard work," which nobody else in this research explicitly measures.
- **Usage Leaderboard** — a per-user ranking, name and email attached
- **Cloud Agent metrics** — agents created, pull requests opened, lines of code, for Cursor's background/autonomous agents specifically — separate from the interactive editor numbers
- Spend and token use, visible to admins alongside all of the above

Cursor is also the only product in this set with a bundled code-review bot (Bugbot) reporting its own numbers: bugs found, bugs actually fixed, cost per review run.

## 4. Sourcegraph (Cody / Amp)

Simpler: daily/weekly/monthly active users, average days used per month (a stickiness measure), number of searches/chats/autocomplete suggestions, and a completion acceptance rate — all sliceable by user, day, editor, and language. Nothing here goes further than "are people using it and does the auto-complete get accepted," and Sourcegraph's own materials describe it mainly as an adoption-tracking tool, not an ROI tool.

## 5. Devin (Cognition)

Devin bills in "ACUs" (its own unit of compute), and the admin view is built around that: total ACU spend, broken down by user and by session, plus session count, PR count. Because Devin runs full tasks on its own rather than suggesting lines, its numbers skip "acceptance rate" entirely and go straight to "how much compute did this org burn and who burned it."

## 6. Windsurf

Similar shape to Cursor but thinner: percent of code written by AI, total lines of code, tool calls, credit (spend) consumption, acceptance rate — at individual, team, and org level.

## 7. The engineering-intelligence vendors (DX, Faros AI, Jellyfish, LinearB, Swarmia)

These companies don't make the coding tool — they sit on top of Claude Code, Copilot, Cursor, etc. and try to answer the question none of the vendors above can answer honestly on their own: **did any of this actually help?**

**DX (getdx.com)** — built by Laura Tacho (their CTO) as an explicit reaction to acceptance rate being a bad number. Their "AI Measurement Framework" groups everything into three buckets:
- **How much people use it** — weekly active users, percent of pull requests that involved AI, percent of committed code that's AI-written (they claim to detect this from how fast and in what pattern text lands in a file, not by trusting the tool's own self-report)
- **What it actually changed** — time saved per developer per week, developer satisfaction (asked directly, on a survey), and whether the delivery numbers (like how many pull requests ship, how often something breaks in production) moved for heavy users vs. light users
- **What it cost** — total spend, still the least developed part of their product by their own admission

**Faros AI** — the most openly critical of the group. Their public position: companies are falling into "tokenmaxxing" — treating how many tokens the AI burned as if that were a good thing, the same mistake as counting lines of code in the 2000s. They found that AI use makes individual developers look busier (more tasks closed, more PRs opened) while the team's actual delivery speed doesn't move, and bug rates creep up. Their answer is a bigger framework (10 measures they call GAINS) but the plain point is: watch what ships and what breaks, not what the tool produced.

**Jellyfish** — sells a Copilot-specific dashboard that connects usage to existing delivery numbers (cycle time, how many PRs get done). Their pitch is explicitly "don't trust the vendor's own dashboard" — connect the usage data to your own ticket tracker and git history so a vendor can't be graded on its own homework.

**LinearB / Swarmia** — layer AI usage on top of standard DORA numbers (how often you deploy, how long a change takes to ship, how often a deploy breaks something, how fast you recover). LinearB's 2026 benchmark report found technical debt went up 30-41% after teams adopted AI tools — which is exactly the kind of number that a pure usage dashboard would never surface.

## Answering the four questions

### 1. The 8-12 things a VP Engineering / CTO actually wants to see, ranked

1. **How much did we spend, and per what** (per developer, per team, per model) — the money question always comes first once a tool is at scale
2. **Who is really using it vs. who has a seat and never opens it** — active users vs. licensed users; the gap tells you if you're wasting money on seats
3. **How deep is the use** — did people just turn on autocomplete, or are they handing whole tasks to an agent? (Copilot's "phases," Cursor's agent-vs-tab split)
4. **How much code did it write, and how much of that code stuck around** — not "lines suggested," but lines still in the codebase weeks later
5. **Did delivery actually speed up** — the standard shipping numbers: how often you deploy, how long a change takes from first commit to live, measured before and after
6. **Did quality go down** — how often something breaks after a change ships, how many bugs come back, how long code review takes (several sources flagged review time going up sharply as the hidden cost)
7. **Time saved per person, in hours** — the number that gets turned into a dollar figure for a business case
8. **Which teams or repos have adopted it and which haven't** — where to spend a rollout push next
9. **A trend line over time, not a single snapshot** — is adoption still climbing or did it plateau
10. **Acceptance rate, but only as one input among many, never alone** — nearly every credible source said this number by itself misleads
11. **A leaderboard of top individual users** — useful for finding internal champions, risky if used to judge individual performance
12. **Satisfaction, asked directly** — "do developers say this is actually helping," because the automatic numbers can lie in both directions

### 2. The one hero number

There isn't a single number everyone agreed on, but the honest answer from the research is: **hours of developer time saved per week, turned into a dollar figure, compared against what we're paying for the tool.** Everything else — active users, lines of code, acceptance rate — is a leading indicator that feeds into this one number. The vendors selling the coding tool itself (Anthropic, GitHub, Cursor) tend to stop at "lines of code / PRs / commits produced," because that's flattering and easy to measure. The vendors one layer up (DX, Faros, Jellyfish) all converge on time-saved-turned-into-money as the number a CFO will actually sign off on, specifically because it's the one number that can be checked against reality (did the team actually ship faster, or not) rather than just trusting what the tool says about itself.

### 3. What makes these dashboards fail or get ignored

- **The tool grades its own homework.** Every coding-tool vendor's dashboard reports numbers the tool itself decides how to count. Buyers increasingly don't trust a vendor's own acceptance rate or "AI share of code" number without an outside check.
- **Acceptance rate gets gamed the moment it's a target.** If you tell developers "we want acceptance rate up," they stop reading the suggestions and just click accept, then quietly rewrite it, or worse, keep bad code. Multiple sources named this exact failure by name. The same happens with lines of code: if it's tracked as a good thing, people ask the AI to write bigger, more padded changes.
- **Busier-looking is not the same as faster-shipping.** The clearest finding across sources: individual output metrics go up (more tasks closed, more PRs opened per person) while the team's actual delivery speed stays flat or gets worse, because code review becomes the bottleneck instead. A dashboard that only shows the "up" numbers and not the review slowdown will eventually be seen as spin.
- **No agreement on what "good" looks like.** A dashboard showing "acceptance rate: 65%" is meaningless without knowing whether that's high or low for your kind of work — some vendors now sell benchmark comparisons for exactly this reason.
- **Used to rank or punish individuals.** The moment a leaderboard or per-person number gets used in a performance review, people stop trusting the whole dashboard and start gaming their own numbers.
- **Vanity numbers with no link to outcomes.** Lines of code and token counts get called out repeatedly as the modern version of an old mistake — a number that goes up no matter whether the work was good, bad, or wasted.

### 4. What a buyer needs before they'll act on a number

- **It has to be checked against something outside the tool** — tied to git history, the ticket tracker, or production incident data, not just the vendor's own event log. This is the entire reason Jellyfish/Faros/DX/LinearB exist as a market: buyers don't fully trust the coding tool's self-reported numbers on their own.
- **It has to be paired with a quality number, not just a speed or volume number** — nobody trusts "we shipped more" without also seeing "and here's what happened to bugs and review time."
- **It has to hold up over months, not a one-week spike** — a trend line, because a single snapshot right after rollout is usually inflated by novelty.
- **It has to have a benchmark or baseline** — "compared to before we had this tool" or "compared to similar companies," so a raw number has meaning.
- **It has to not be usable as an individual weapon** — team and org-level rollups build trust faster than per-person leaderboards, because people don't feel a reason to game a number that isn't judging them personally.
- **It has to connect all the way to money** — spend per developer, set against time saved or output shipped, in the same view, so a CTO doesn't have to do the math by hand across two different systems (billing vs. usage).

## Sources

- [Claude Code Analytics API](https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api)
- [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [Claude Code Analytics API - search results](https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api)
- [GitHub Copilot usage metrics - GitHub Docs](https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics)
- [REST API endpoints for Copilot usage metrics - GitHub Docs](https://docs.github.com/en/rest/copilot/copilot-usage-metrics)
- [Copilot usage metrics reference](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics)
- [New Copilot usage metrics impact dashboard - GitHub Changelog](https://github.blog/changelog/2026-07-22-new-copilot-usage-metrics-impact-dashboard/)
- [Organization-level Copilot usage metrics dashboard - GitHub Changelog](https://github.blog/changelog/2026-02-20-organization-level-copilot-usage-metrics-dashboard-available-in-public-preview/)
- [GitHub Copilot Analytics: How to Track Usage Metrics - Jellyfish](https://jellyfish.co/library/github-copilot-analytics/)
- [Analytics | Cursor Docs](https://cursor.com/docs/account/teams/analytics)
- [Analytics API | Cursor Docs](https://cursor.com/docs/account/teams/analytics-api)
- [Dashboard | Cursor Docs](https://cursor.com/docs/account/teams/dashboard)
- [Cursor Analytics to Monitor AI Code Generation & Adoption - Jellyfish](https://jellyfish.co/library/cursor-usage-analytics/)
- [DX: AI code metrics for productivity](https://getdx.com/ai-code-metrics/)
- [How to implement the AI Measurement Framework in DX](https://getdx.com/blog/how-to-implement-ai-measurement-framework/)
- [Measuring AI code assistants and agents - DX Research](https://getdx.com/research/measuring-ai-code-assistants-and-agents/)
- [Faros Blog: Engineering Productivity & AI Transformation](https://www.faros.ai/blog)
- [Faros AI DORA Metrics Dashboard](https://www.faros.ai/dora-metrics)
- [Measure AI Coding ROI and AI Impact Dashboard | Jellyfish](https://jellyfish.co/platform/jellyfish-ai-impact/)
- [Introducing the GitHub Copilot Dashboard | Jellyfish Blog](https://jellyfish.co/blog/introducing-jellyfish-github-copilot-dashboard/)
- [LinearB vs Swarmia: Engineering Analytics Platform Comparison 2026 | Pensero](https://pensero.ai/blog/linearb-vs-swarmia)
- [LinearB vs Swarmia | Productivity Platform vs. Generic Metrics](https://linearb.io/compare/swarmia-vs-linearb)
- [How to Measure AI ROI on Your Engineering Team - Waydev](https://waydev.co/how-to-measure-ai-roi-on-your-engineering-team/)
- [How to Measure AI Coding Agent ROI: The Engineering Leader's Framework (2026) — amux](https://amux.io/guides/measuring-ai-coding-agent-roi/)
- [5 Tools for Measuring AI ROI — And What They Miss - Olakai](https://olakai.ai/blog/ai-roi-measurement-tools/)
- [AI Coding Tool ROI: Why Acceptance Rate Misleads - Olakai](https://olakai.ai/blog/ai-coding-tool-roi-metrics/)
- [The rise – and looming fall – of acceptance rate - LeadDev](https://leaddev.com/reporting/the-rise-and-looming-fall-of-acceptance-rate)
- [Devin Usage Metrics - Devin Docs](https://docs.devin.ai/api-reference/v2/consumption/usage-metrics)
- [Windsurf Analytics Docs](https://docs.windsurf.com/windsurf/accounts/analytics)
- [How to Track Windsurf AI Usage in Your Organization | Worklytics](https://www.worklytics.co/blog/track-if-employees-are-using-windsurf)
- [Sourcegraph Analytics - Sourcegraph docs](https://sourcegraph.com/docs/analytics)
- [Understand the value of Sourcegraph with admin analytics | Sourcegraph Blog](https://sourcegraph.com/blog/admin-analytics)
- [Cody Analytics is now Sourcegraph Analytics](https://sourcegraph.com/changelog/sourcegraph-analytics)
