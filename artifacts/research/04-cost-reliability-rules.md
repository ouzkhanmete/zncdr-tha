# Cost, Reliability, and Rules for an Org Dashboard on AI Coding Agents

Plain-language research notes for building the dashboard's data model. Written for a platform owner who pays the bill and has to keep things safe.

---

## A. Money

### A1. How usage is actually measured and charged

Every AI provider charges by counting small chunks of text called tokens, roughly 3/4 of a word each. A run of an agent adds up several separate counters, and each counter has its own price:

- **Input tokens** — everything sent to the model: the user's request, file contents, past messages, tool descriptions.
- **Output tokens** — everything the model writes back, including code.
- **Thinking tokens** — on models with an "extended thinking" mode, the model's internal reasoning text. Anthropic bills these as ordinary output tokens, at the output price, so a long internal reasoning pass can cost several times more than the visible answer. ([Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing))
- **Cache write** — the first time a chunk of text (like a system prompt or a big file) is stored so it can be reused, it costs more than a normal input token. On Claude: 1.25x the input price for a 5-minute cache, 2x for a 1-hour cache. ([Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing))
- **Cache read (a "hit")** — reusing that stored text later is cheap: about 1/10th the normal input price on both Claude and OpenAI. ([Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing))
- **Tool and compute time** — using a tool like a sandboxed code runner or a browser is billed by time as well as tokens. Anthropic's code-execution container is free up to 1,550 hours per org per month, then $0.05 per container-hour. Anthropic's hosted "Managed Agents" also charge $0.08 for every hour a session is actually running (not counting idle time). Web search costs $10 per 1,000 searches on top of tokens. ([Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing))
- **Batch discount** — if a task can wait (no live user watching), running it through a batch queue instead of live cuts the price roughly in half on all three major providers. ([Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing))

**Current published prices, per million tokens, as of August 2026** (numbers move often — always re-check the vendor page before hard-coding them):

| Provider / model | Input | Cached input | Output |
|---|---|---|---|
| Anthropic Claude Opus 5 | $5 | $0.50 | $25 |
| Anthropic Claude Sonnet 5 | $2 | $0.20 | $10 |
| Anthropic Claude Haiku 4.5 | $1 | $0.10 | $5 |
| OpenAI gpt-5.6-sol | $4 | $0.40 | $20 |
| OpenAI gpt-5.6-terra | $2 | $0.20 | $12 |
| OpenAI gpt-5.5 | $5 | $0.50 | $30 |
| Google Gemini 3.1 Pro | $2 | — | $12 |
| Google Gemini 3.5 Flash | $1.50 | — | $9 |

Sources: [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [Google Gemini pricing round-up](https://www.cloudzero.com/blog/gemini-pricing/) (Google does not always publish cached-input rates on the same page; check the model's own doc page before billing on it).

**A realistic cost formula for one agent run:**

```
run_cost =
    (input_tokens_new      × input_price)
  + (cache_write_tokens    × input_price × cache_write_multiplier)
  + (cache_read_tokens     × input_price × 0.1)
  + (output_tokens         × output_price)
  + (thinking_tokens       × output_price)      # if the model has a thinking mode
  + (tool_seconds / 3600   × per_hour_tool_rate) # sandboxes, browsers, code runners
  + (extra_metered_tools)                        # e.g. web search per call
```
Apply the batch multiplier (about 0.5x) to the whole formula if the run was queued instead of live. Multiply the token portion by any region surcharge (Anthropic adds 10% for US-only data routing).

### A2. How teams set and enforce budgets

Two levels of budget are standard practice, often set on the same team at once:

- **Soft warning** — a threshold that only sends an email or alert. Requests keep working. Meant to be an early heads-up, not a block.
- **Hard stop** — a ceiling that blocks new requests once spend crosses it. Meant as a true financial backstop.

Example from an open-source AI-usage gateway (LiteLLM): a team gets an email once spend crosses the soft number, and is blocked outright once it crosses the hard number, with both configured together. ([LiteLLM soft budget alerts](https://docs.litellm.ai/docs/proxy/ui_team_soft_budget_alerts))

Common practice across gateway tools (LiteLLM, Portkey, MLflow's AI gateway):
- Track spend by team, by individual person, by project, and by which model was used — because a "team" quota is meaningless if you can't see which model burned the money.
- Give budgets a time window: daily, weekly, or monthly, resetting on a schedule.
- Reserve the hard stop for cases where there's a safe fallback (switch to a cheaper model, queue the work, ask a human) — a hard stop with no fallback just breaks people's work. Use warn-only while a new workflow is still being tuned. ([Portkey: budget limits and alerts](https://portkey.ai/blog/budget-limits-and-alerts-in-llm-apps/), [CloudNuro: token budget enforcement](https://www.cloudnuro.ai/blog/llm-token-budget-enforcement-guide))
- Track "burn rate vs. days left" — if a team has used 80% of its monthly budget by day 10, that is a very different signal than using 80% by day 28. The dashboard should show the pace, not just the total.

### A3. "Cost per finished task" — and why it's the number that matters

Price per token tells you almost nothing about what a task will actually cost, because two runs of the same model can burn wildly different numbers of tokens depending on how many retries, tool calls, and reasoning steps it took. The number that maps to the actual bill is **cost per finished task**: total dollars spent (across every run, retry, and tool call) divided by whether the task was actually completed. ([PointFive Coding Task Index](https://www.pointfive.co/blog/the-pointfive-coding-task-index), [Ivern AI cost-per-task benchmark](https://ivern.ai/blog/ai-agent-cost-benchmark-report-2026))

To compute it fairly when a task takes several runs (first attempt fails, agent retries, or a person nudges it and it tries again):

```
cost_per_finished_task = sum(cost of every run tied to this task, including failed attempts)
                          ÷ (1 if the task eventually finished, else undefined/marked "abandoned")
```

The key fairness rule: **failed attempts still count in the numerator.** A cheap model that fails half the time and needs a retry can end up costing more per finished task than an expensive model that gets it right the first time. Reporting only the cost of the successful run and ignoring the failed ones before it understates true cost and hides which setups are actually wasteful. The dashboard should track both "cost of the winning run" and "total cost across all runs tied to the task" side by side.

---

## B. Reliability

### B1. Why an agent run fails — a plain list of reasons

Research on real coding-agent failures (large studies of GitHub issues, session logs, and lab benchmarks) groups the causes into a fairly short list. ([Microsoft: Taxonomy of Failure Mode in Agentic AI Systems](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Taxonomy-of-Failure-Mode-in-Agentic-AI-Systems-Whitepaper.pdf), [study of 20,574 real agent sessions](https://arxiv.org/pdf/2605.29442), [Galileo: 7 agent failure modes](https://galileo.ai/blog/agent-failure-modes-guide))

| # | Failure reason (plain words) | What it looks like | Whose fault |
|---|---|---|---|
| 1 | Missing permission | Agent tries an action the account isn't allowed to do | Org setup |
| 2 | Missing secret or login | Agent needs an API key, password, or token that was never given to it | Org setup |
| 3 | Tool not available | Agent tries to call a tool that isn't installed or wired up | Org setup / platform |
| 4 | Sandbox or network blocked | Agent's outbound network call or file access is blocked by a safety wall | Org setup (usually deliberate) |
| 5 | Dependency install failed | A package, library, or environment setup step breaks | Task (bad environment) or platform (broken registry) |
| 6 | Ran out of context room | Conversation or file content got too big for the model to hold at once, and older information got silently dropped | Platform / task size |
| 7 | Hit a token or time limit | The run was cut off by a budget cap or a maximum-runtime clock | Org setup (limit was set) |
| 8 | Model refused | The model declined the request on safety grounds | Task (the ask itself) |
| 9 | User cancelled | A person stopped the run on purpose | Not a failure — track separately |
| 10 | Tests failed | The agent's own code didn't pass the test suite | Task (code quality) — expected, not a platform problem |
| 11 | Produced nothing useful | Agent finished without error but the output doesn't solve the task | Task or model quality |
| 12 | Infrastructure crash | The underlying service, container, or machine died mid-run | Platform |
| 13 | Rate limited | Too many requests hit the provider's per-minute cap | Platform capacity / org's traffic pattern |

Attribution matters because it decides what the dashboard should nag about. Reasons 1–4 and 7 are org-setup problems — fixable by whoever configures the agent's permissions and limits, and are exactly what a dashboard should flag as "fix your setup." Reasons 6, 12, and 13 are platform problems the org can't fix directly, only work around. Reasons 8–11 are closer to the nature of the task itself, and should not count against either the platform or the org's setup — they belong in a "task difficulty" bucket, not a "something is broken" bucket.

Separately, research also distinguishes **loud failures** (the run stops and says why) from **silent failures** — the run finishes normally, looks fine, but quietly did the wrong thing (dropped context without saying so, or reported success on a task it didn't actually finish). Silent failures are called out as the hardest kind to catch because nothing in the log complains. ([Silent Failure in LLM Agent Systems](https://arxiv.org/pdf/2606.08162))

### B2. Numbers worth putting on the dashboard

- **Failure rate** — the share of runs that don't finish the task. Published field numbers are sobering: one large study found agents that look good in a demo fail on the first try 70–95% of the time once run on real work, and a Carnegie Mellon study clocked common office tasks failing about 70% of the time. ([Fiddler AI: AI agent failure rate](https://www.fiddler.ai/blog/ai-agent-failure-rate))
- **Retry rate** — how often a run needed a second (or third) attempt before finishing. High retry rate with low final-failure rate still means real money spent on do-overs.
- **Repeat-run consistency** — running the exact same task 8 times in a row, one benchmark saw the success rate fall from 60% on a single try to 25% by the eighth run — a reminder that "it worked once" doesn't mean it reliably works. ([Fiddler AI](https://www.fiddler.ai/blog/ai-agent-failure-rate))
- **Chained-task success** — if a job is really three agent steps in a row, each with a 70% success rate on its own, the whole chain only succeeds about 34% of the time (0.7 × 0.7 × 0.7). Multi-step pipelines should show the combined odds, not just each step's own number.
- **Mean time between failures** — for a team running many agents continuously, how much run-time typically passes before something breaks; useful for spotting a team or model version whose failure clock has gotten shorter.
- **Time-to-give-up** — how long (or how many steps) a run goes before the agent or platform decides to stop trying, so slow-motion failures don't quietly burn budget for hours before anyone notices.

---

## C. Rules and safety

### C1. What safety rules ("guardrails") orgs actually put around agents

Practices seen across vendor guidance and enterprise gateway tools:

- **Where it can go on the network** — an allowed list of domains it can reach, and everything else blocked by default. Anthropic's own guidance for its "computer use" agent says to run it in a clean sandboxed machine with network access limited to only the sites the task needs. ([Anthropic: framework for safe agents](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents))
- **What secrets it can touch** — scoping credentials down to only what the task needs, never a broad master key.
- **Which folders or files it can touch** — a fenced-off working directory instead of the whole disk.
- **Which commands it can run** — an allowed list of shell commands rather than free rein.
- **Whether data can leave the network** — blocking the agent from sending files, code, or output to outside services it wasn't told to use.
- **A spending ceiling** — the budget controls from Section A, tied to the same permission system.
- **A human check before risky steps** — Anthropic's Claude Code, by default, is read-only until a person approves a change; some actions can be pre-approved for routine, low-risk cases. ([Anthropic: framework for safe agents](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents))

### C2. What counts as "the agent tried something it shouldn't have"

Two public reference lists name the specific things to watch for. Both are useful as a checklist for what a "rule broken" event in the database should look like.

**OWASP's Top 10 list for LLM-powered apps** (general risks, not agent-specific): ([OWASP Top 10 for LLM Applications, via Kodem](https://www.kodemsecurity.com/resources/owasp-top-10-for-llm-applications))

1. Prompt injection — hidden text tricks the model into acting against its instructions
2. Sensitive information leak — private data or credentials show up in the output
3. Supply chain — a bad third-party model, package, or plug-in
4. Data or model poisoning — training or reference data was tampered with
5. Unsafe output handling — the model's raw output gets run or trusted without checking
6. Too much freedom given to the model ("excessive agency") — it's allowed to do more than the task needs
7. System prompt leak — the hidden setup instructions get exposed
8. Weaknesses in the search/lookup index it uses for reference material
9. Confidently wrong answers that a person or downstream system then trusts
10. Unlimited resource use — nothing stops it from running up huge cost or load

**OWASP's newer list specifically for agents that use tools and take actions:** ([OWASP Top 10 for Agentic Applications, via Promptfoo](https://www.promptfoo.dev/docs/red-team/owasp-agentic-ai/))

1. Its goal gets hijacked by something it read
2. It uses a legitimate tool in an unsafe way
3. It grabs or is handed more access than it needs
4. A tool, plug-in, or add-on it depends on is compromised
5. It writes or runs code/commands it shouldn't
6. Its memory or reference data gets tampered with
7. In a multi-agent setup, one agent fakes or tampers with messages to another
8. A small mistake early on snowballs into a bigger failure downstream
9. A person trusts its recommendation too much and skips checking it
10. The agent itself has been compromised and looks normal while acting badly

The government reference point is the **NIST AI Risk Management Framework**, which asks orgs to do four things on a repeat cycle: set policy and ownership up front (Govern), understand where the specific risks are for this system (Map), keep measuring those risks while it runs (Measure), and have a real response plan ready when something goes wrong (Manage) — including a way to shut an agent down fast if needed. ([NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework), [applying NIST AI RMF to agents](https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/))

The most concrete real-world danger called out again and again: **prompt injection that leads to an unwanted tool call** — text hidden in a file, webpage, or ticket the agent reads tricks it into taking a real action (send a message, delete a file, call an outside service) that the person running it never asked for. Recommended defenses: check every proposed action against what the person actually asked for before running it, give the agent only the access the task strictly needs, and require a person's sign-off on any step that can't be undone. ([Prompt injection and tool misuse guidance](https://goteleport.com/blog/prevent-prompt-injection/))

### C3. How to show a rule-break flag so it's useful, not noise

- **Give it a severity level**, not just a yes/no flag. A reasonable three-tier split:
  - *Low* — worth logging, no action needed (e.g., agent tried a domain not on the allowed list and was blocked as designed).
  - *Medium* — someone should look at it soon (e.g., agent asked for a permission it doesn't normally need).
  - *High* — stop and tell a person right now (e.g., agent tried to send data outside the network, or run a destructive command).
- **Route it to the right person.** A low flag can just sit in a weekly report. A high flag should page whoever owns that team's agents, not just log quietly.
- **Expect false alarms and plan for them.** A rule fired because the setup blocked it as designed is not the same as a rule almost being broken — the dashboard should let someone mark a flag "expected / working as intended" so the same harmless pattern doesn't page anyone twice. Track how often flags get dismissed this way; a rule that's wrong most of the time should be retuned, not ignored.
- **Show the trend, not just the count.** One team having ten low flags a day is normal noise; a team suddenly getting flags it never got before is the signal worth surfacing first.

---

## Concrete lists for the database schema

**Failure reasons (for a `run_failure_reason` enum):**
`missing_permission`, `missing_secret`, `tool_unavailable`, `network_or_sandbox_blocked`, `dependency_install_failed`, `context_window_exceeded`, `token_or_time_limit_hit`, `model_refused`, `user_cancelled`, `tests_failed`, `no_useful_output`, `infra_crash`, `rate_limited`

Each should carry an `attributed_to` field: `platform`, `org_setup`, or `task`, plus a boolean `is_silent_failure` for cases where the run reported success but didn't actually finish the task.

**Rule-break types (for a `safety_flag_type` enum):**
`prompt_injection_suspected`, `goal_hijack`, `tool_misuse`, `privilege_escalation`, `blocked_domain_attempt`, `secret_or_credential_exposure`, `unsafe_command_execution`, `data_exfiltration_attempt`, `supply_chain_risk` (compromised tool/plug-in), `memory_or_context_poisoning`, `inter_agent_spoofing`, `spend_cap_exceeded`, `excessive_agency` (asked for more access/scope than the task needs)

Each should carry a `severity` field (`low`, `medium`, `high`), a `disposition` field (`confirmed`, `expected_and_dismissed`, `under_review`), and a `notified` field (who was told, if anyone).
