# Engineering manager lens: what already exists, and what a manager does with it on Monday morning

## 1. Which frameworks to borrow from, and which parts break for agent runs

**DORA (the four keys, now five).** The original four numbers are: how often you ship, how long it takes a change to go live, how often a change breaks something, and how long it takes to fix it when it does. These are well tested and worth keeping as the backbone of any dashboard.

But the 2025 DORA report found something that matters a lot for us: when teams added AI, shipping got faster but things also broke more, unless the team's underlying habits (small changes, fast review, good tests) were already solid. Their own words: "AI improves throughput, but often at the cost of stability if your foundation isn't solid." One report even measured a pattern they call "acceleration whiplash" — pull requests got 51% bigger, review time went up 441%, and incidents per pull request went up 243% at some organizations. The lesson for us: never show a speed number without its matching breakage number right next to it. A dashboard that only shows "shipped faster" will look great for a few weeks right before it looks terrible.

What doesn't transfer cleanly: "how often you ship" assumes a human decides when to ship. An agent can produce dozens of small changes in an hour. Counting raw ship frequency for agent work is close to meaningless unless you normalize it against the size of the work done.

**SPACE (five angles on productivity: how developers feel, what they produce, how much they do, how well they talk to each other, how smoothly work flows).** SPACE's main point, made by its own authors, is a warning: don't judge a developer by activity alone (commits, lines written), because activity is the easiest thing to fake and the least informative thing to look at. That warning applies even harder to agents — an agent can generate huge amounts of activity that means nothing. Counting "lines an agent wrote" or "number of agent runs" as a success number would repeat exactly the mistake SPACE was written to stop.

What doesn't transfer: SPACE's "how well they talk to each other" angle (meetings, code review comments, mentoring) assumes people working with people. An autonomous agent run has no equivalent, so don't force one.

**DX Core 4 (speed, quality, how much friction developers feel, and how much of the work is new value vs. upkeep).** This is the closest existing template to what we're building, because it already blends DORA and SPACE into one small set of numbers meant for leaders. DX has also just published an AI-specific add-on built for exactly our problem: it tracks three things — how much people actually use the tool, what effect that use has, and what it costs. That three-part shape (usage, effect, cost) is the single most reusable idea from all the research and should shape our dashboard's top level directly.

## 2. What a manager wants vs. what a VP wants vs. what one engineer wants

- **A team manager** wants this week's operational picture: which of my agent workflows are stuck, where is review backing up, did anything I shipped this week break, is my team actually using the tool or ignoring it. They want to act inside the sprint.
- **A VP / head of platform** wants the multi-month trend across many teams: is spend on agent tooling paying off, which teams have adopted well and which are stalled and need help, is quality holding steady org-wide as usage grows. They want to make budget and rollout decisions, and to know which teams to invest more coaching in — not to grade teams against each other publicly.
- **One engineer looking at their own page** wants to know if the tool is helping or slowing them down personally, and wants that answer to stay theirs. The moment their number gets compared to a teammate's, the page stops being useful and starts being a threat.

## 3. Handling per-person data without building a surveillance tool

Real engineering orgs that measure this well converge on the same rule: individual data is for the individual, team data is for the manager, and nobody gets ranked. From the research:

- "Never use productivity data for performance reviews — the moment you do, the metrics become worthless" (this is the single most repeated warning across sources).
- Individual number-tracking pushes people to split work into more commits, avoid hard tasks, or stop pairing — because now the numbers matter more than the work.
- The fix that works in practice: say it out loud to the team — "these are team numbers for improving how we work, we will never rank people by them, and you can see the exact same dashboard I see."

**What our UI should deliberately never show:**
- A leaderboard or sorted list of people by agent usage, acceptance rate, or output.
- Any per-person breakage/revert rate visible to a manager by default.
- Anything that lets a manager infer "who is slow" or "who barely uses the tool" from a glance.
- Individual data should default to visible only to that person, shown against their own past self, never against a teammate. A manager should see team-of-several-people aggregates, not a roster with numbers next to each name.

## 4. Five actions a manager can take, each triggered by a specific number crossing a specific line

1. **Revert/rollback rate on agent-touched changes goes above roughly twice the team's normal (human) rate for two weeks running** → require a human review step before merge for that agent workflow, instead of banning the tool outright.
2. **Review time on agent-generated pull requests grows much slower than the code itself does** (DORA saw review time balloon 441% while output size grew far less) → the manager's move is to cap the size of agent-generated diffs and require them to land in smaller pieces.
3. **Incidents per change go up after an agent workflow is turned on for a team** → pull that team back to a staging step before production for agent-authored changes until the number recovers.
4. **Weekly active use of the tool stays under roughly 30% of the team for a month after rollout** → this is a friction problem, not a discipline problem — run a session to find out what's blocking people (slow responses, wrong permissions, distrust) instead of mandating usage.
5. **Money spent on agent time exceeds the time it's actually saving people** (DX calls this "net time gain" going negative) → the manager or VP narrows which teams or task types get agent access to the ones where it's clearly paying off, rather than cutting it everywhere.

## 5. Leading indicators (warn you) vs. lagging indicators (report on the past)

**Leading — watch these to catch trouble early:**
- Pull request size creeping up.
- Review time creeping up relative to pull request size.
- A growing backlog of agent-produced work waiting on a human to look at it.
- How often people reject or throw away what the agent produced.
- Usage trend (is adoption still climbing, flat, or falling).

**Lagging — these tell you what already happened:**
- How often a shipped change broke something.
- How often code gets reverted or rewritten shortly after landing.
- Time to fix something that broke.
- Actual cost spent.

The DORA research is the clearest evidence for why both matter together: the speed numbers moved first, and the breakage numbers only showed up weeks later. A dashboard that shows speed alone will look like a win right up until the delayed damage arrives. The design conclusion: put a leading indicator (queue depth, review time, reject rate) next to its matching lagging indicator (breakage, revert rate) so a manager sees the warning before the damage, not just the damage after the fact.

---

### Sources
- [DORA 2025: Year in review](https://dora.dev/insights/dora-2025-year-in-review/)
- [Announcing the 2025 DORA Report — Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
- [DORA Report 2025 Key Takeaways: AI Impact on Dev Metrics — Faros AI](https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025)
- [DORA: Balancing AI tensions — moving from AI adoption to effective SDLC use](https://dora.dev/insights/balancing-ai-tensions/)
- [DORA 2025: Measuring Software Delivery After AI — RedMonk](https://redmonk.com/rstephens/2025/12/18/dora2025/)
- [The SPACE of Developer Productivity: There's more to it than you think — Microsoft Research](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/)
- [What is the SPACE framework and when should you use it? — DX](https://getdx.com/blog/space-metrics/)
- [The SPACE of Developer Productivity — DX research reprint](https://getdx.com/research/space-of-developer-productivity/)
- [DX Core 4 engineering metrics](https://getdx.com/dx-core-4/)
- [Guide to the DX Core 4 — docs.getdx.com](https://docs.getdx.com/dx-core-4/)
- [AI measurement framework: Complete guide for engineering leaders — DX](https://getdx.com/blog/ai-measurement-framework-guide/)
- [How to implement the AI Measurement Framework in DX](https://getdx.com/blog/how-to-implement-ai-measurement-framework/)
- [Introducing the AI Measurement Framework — DX](https://getdx.com/blog/introducing-the-ai-measurement-framework/)
- [Measuring AI code assistants and agents — DX whitepaper](https://getdx.com/whitepaper/ai-measurement-framework/)
- [Revisiting the DX Core 4 in the Age of AI — Brian Houck](https://newsletter.getdx.com/p/revisiting-the-dx-core-4)
- [Unleash developer productivity with generative AI — McKinsey](https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/unleashing-developer-productivity-with-generative-ai)
- [Unlocking the value of AI in software development — McKinsey](https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/unlocking-the-value-of-ai-in-software-development)
- [Does GitHub Copilot improve code quality? — GitHub Blog](https://github.blog/news-insights/research/does-github-copilot-improve-code-quality-heres-what-the-data-says/)
- [New GitHub Copilot Research Finds 'Downward Pressure on Code Quality' — Visual Studio Magazine](https://visualstudiomagazine.com/articles/2024/01/25/copilot-research.aspx)
- [Is GitHub Copilot Worth It? Here's What the Data Says — Faros AI](https://www.faros.ai/blog/is-github-copilot-worth-it-real-world-data-reveals-the-answer)
- [So, you'd like to stack rank your developers? — Swarmia](https://www.swarmia.com/blog/dont-stack-rank-your-developers/)
- [Your developer productivity metrics might be missing the whole point — Swarmia](https://www.swarmia.com/blog/developer-productivity-metrics-missing-the-point/)
- [Engineering Management Nugget #4: Guardrails Over Control](https://dev.to/lek890/engineering-management-nugget-4-guardrails-over-control-3j0f)
- [What are leading and lagging indicators? — The Engineering Manager](https://theengineeringmanager.substack.com/p/what-are-leading-and-lagging-indicators)
- [How to Scale AI Coding Assistants Across Thousands of Engineers — Faros AI](https://www.faros.ai/blog/enterprise-ai-coding-assistant-adoption-scaling-guide)
