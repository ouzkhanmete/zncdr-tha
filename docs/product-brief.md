# Product brief

## The thing

A company gives its engineers a service that runs coding agents in the cloud. An engineer
hands an agent a task, the agent goes away, works, and comes back with something: a pull
request, a commit, a file, a report, or nothing.

This dashboard is what the company's leaders open to find out how that is going.

## Who opens it and what they came for

| Who | Comes to ask | Needs the answer at |
|---|---|---|
| CTO / VP Engineering | Is this paying for itself, and is anything going wrong I can't see? | Org, month over month |
| Engineering manager | Is my team getting value, is anything stuck or breaking, am I about to blow my budget? | Team, this week |
| Platform / finance owner | Where is the money going and which teams are over the line? | Org and team, this month |
| An engineer | Is this helping me? | Their own page, and nobody else's |

## The one number

**Money spent against value returned.**

Every other number on the screen exists to make that one believable or to explain it.

We work it out like this:

```
value returned = finished tasks x hours saved per task x cost of an engineer hour
money spent    = every dollar burned on runs in the period, failed runs included
net            = value returned - money spent
```

Two of those inputs are guesses, not facts: hours saved per task, and what an engineer hour
costs. **So we put them on screen as boxes you can change, at the top of the page, with our
defaults filled in.** A number whose assumptions are hidden is a number nobody acts on. A
number where you can turn the dial yourself and watch it move is one you argue with, and then
believe.

### Say the break-even, not just the net

Next to the net figure, the screen states the point where the thing pays for itself:

> A finished task costs about **$5.31**. An engineer hour costs **$85**. So this pays for itself
> if a task saves more than **about four minutes**.

The screen works this out from whatever is actually on it — it is not a fixed sentence. Change the
date range and it changes.

This is the most persuasive line on the page and the cheapest to check. A big net number invites
"you picked the assumptions"; a break-even in minutes invites "is 5 minutes plausible?" — which is
a question with an obvious answer, and one the reader settles themselves.

It also does something the net number cannot: it stays true when someone disagrees with the dial.
Whatever you believe hours-saved is, the break-even does not move, because it falls out of the
cost per task and the hourly rate alone.

## What we will not build, on purpose

Every source we read landed on the same two warnings, so these are design rules, not opinions.

**No acceptance rate. No lines of code.** Both get gamed the day they become a target. People
rubber-stamp suggestions, or ask for padded changes. Independent measurements found bug rates
and technical debt going up in orgs that chased these numbers. We use a harder, honest
substitute: **did the run produce something a person kept** — a pull request that got merged, a
commit that survived.

**No leaderboards. No ranking people.** The moment per-person numbers can be used to judge
someone, everyone starts protecting their number instead of doing the work, and the whole
dashboard becomes fiction. An engineer's page compares them to their own past, never to a
teammate. A manager sees the team added up, not a list of names with scores.

## The rule that shapes every screen

**Never show a speed or volume number without the matching quality number next to it.**

When orgs added AI, delivery got faster and things broke more — one measured pattern had pull
requests 51% bigger, review time up 441%, and incidents per change up 243%. The speed numbers
move first and look great. The damage shows up weeks later. A dashboard showing only the good
half will look like a win right up until it looks like a disaster.

So: finished tasks sits next to rework rate. Runs per week sits next to success rate. Spend
sits next to what the spend bought.

## Four levels

```
Org        everything, all teams, month over month
 |
Team       one team, this week, against its budget
 |
Engineer   one person, against their own past only
 |
Run        one task: every turn, every tool call, what it cost, what came out
```

Each level answers a different question. The org level asks "is this worth it". The team level
asks "is anything wrong right now". The engineer level asks "is this helping me". The run level
asks "what actually happened".

## What a user can change

Budgets and spend caps. A team gets a monthly money limit with two lines: a **warning line**
that only warns, and a **stop line** that would block new runs. Everything else on the
dashboard is read-only.

We picked budgets as the one thing you can edit because it is the only number on the screen a
leader can act on directly and immediately. Everything else is a report on what already
happened.

## Deliberately out of scope

- No login and no permissions. One reviewer at a time.
- No connection to real git or ticket systems. Our own seeded data stands in for them.
  We note where a real build would need an outside check, because a tool grading its own
  homework is the top reason buyers distrust these dashboards.
- No alerting, email, or paging. Flags sit on a screen.
