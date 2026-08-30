import { z } from "zod"
import { artifactKind, blame, depthOfUseBucket, disposition, failureCause, policyFlagKind, runStatus, severity, toolCallOutcome, trigger } from "./enums.ts"
import { agentKind, isoDateTime, isValidDateOrder, page, pageFilterFields, resolveDateRange, teamId } from "./filters.ts"
import { cents } from "./money.ts"

// Request and response shapes for every endpoint in docs/api.md, one section per section of
// that document. A schema pair is named `<Thing>Param` / `<Thing>Query` / `<Thing>Input` for
// what goes in, and `<Thing>Response` for what comes back, following the names docs/api.md's
// own worked example (section 9) already uses -- TeamIdParam, BudgetInput, BudgetResponse.
//
// A few of docs/api.md's literal TS types don't quite match docs/data-model.md -- the actual
// source of truth for what a stored row can look like. Where the two disagreed, this file
// follows the data model and the mismatch is called out in a comment, so it can be fixed in
// docs/api.md too:
//
//   - RunSummary.status: api.md lists "cancelled_early" and drops "timed_out"; the DB only ever
//     stores the five values in runStatus (running/succeeded/failed/cancelled/timed_out). A
//     "cancelled early" run is just a cancelled run with a short duration -- see the 5-second
//     rule in docs/data-model.md's success-rate query -- not a fifth status value.
//   - RunSummary.repo / .branch / .engineerId: api.md types these as plain strings; data-model.md
//     marks all three nullable (no repo for a report-only task; no engineer for an automation
//     run). Left nullable here to match what a real row can hold.
//   - FailureCause: api.md spells two of the twelve "token_or_time_limit" and "context_limit";
//     data-model.md's CHECK spells them "hit_token_or_time_limit" and "ran_out_of_context". Used
//     the CHECK's spelling, since that's what's actually stored.
//   - Flag "status" (GET /api/flags, /api/metrics/flags byStatus, RunDetail.policyFlags.status):
//     api.md spells these "dismissed_expected" / "investigating"; data-model.md's
//     policy_flags.disposition CHECK spells them "expected_and_dismissed" / "under_review". Used
//     the CHECK's spelling.
//   - RunDetail.toolCalls.outcome: api.md lists only "success" | "error"; data-model.md's
//     tool_calls.outcome CHECK also allows "timeout". Kept "timeout" so a timed-out tool call has
//     a value to report.
//
// One field was tightened rather than corrected: RunSummary.trigger is typed as plain `string`
// in api.md, but data-model.md gives it a two-value CHECK ("person" | "automation"), so it's
// typed here as that enum instead of a loose string.
//
// Seven fields were widened into this contract while the web screens were still being built
// against their own stand-in types, so they used to be marked `.optional()` even though a real
// reply always sends them: RunSummary.taskSummary/.primaryOutputKind, TaskAttempt.failureCause/
// .blame, FlagListItem.teamId/.teamName, and BudgetStatusResponse.dailySpend. Now that every
// screen reads these straight from the real API (step 7, docs/plan.md), the `.optional()` is
// gone -- a field the server always sends should never let a caller silently cope with it being
// absent.

const rate = z.number().min(0).max(1)

const idAndName = z.object({ id: z.string(), name: z.string() })

const monthString = z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")

function currentUtcMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// RunSummary / RunDetail -- shared by section 6 (engineer runs), section 7 (run search and
// detail), defined here since both sections use it.
// ---------------------------------------------------------------------------

export const RunSummary = z.object({
  id: z.string(),
  teamId: z.string(),
  engineerId: z.string().nullable(),
  agentKind: z.string(),
  trigger,
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  parentRunId: z.string().nullable(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  status: runStatus,
  failureCause: failureCause.nullable(),
  blame: blame.nullable(),
  isQuietFailure: z.boolean(),
  durationMs: z.number().int().nonnegative().nullable(),
  totalCostCents: cents,
  turnCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  // A short, one-line description of the task -- see docs/data-model.md's runs.task_summary.
  taskSummary: z.string(),
  // Which kind of thing this run's output was -- pull request, commit, file, or report -- for a
  // run list to show one icon per row without a follow-up call per row. Null when the run
  // produced nothing (most failed, cancelled, or still-running rows). When a run produced more
  // than one artifact (rare -- see docs/seed-data.md, "a few runs producing more than one"), this
  // is the earliest-created one: a deterministic tiebreak, not a judgement that one kind of
  // output matters more than another. See docs/api.md section 7 for the full reasoning.
  primaryOutputKind: artifactKind.nullable(),
})
export type RunSummary = z.infer<typeof RunSummary>

// ---------------------------------------------------------------------------
// Trend -- one point shape shared by two calls: the org/team trend in section 4 and the
// engineer's own trend in section 6. Same numbers, just scoped differently -- see section 4's
// GET /api/trend for why this is pulled out once instead of defined twice.
// ---------------------------------------------------------------------------

export const TrendPoint = z.object({
  periodStart: isoDateTime,
  periodEnd: isoDateTime,
  runsStarted: z.number().int().nonnegative(),
  finishedTasks: z.number().int().nonnegative(),
  successRateFirstTry: rate,
  medianCostPerFinishedTaskCents: cents.nullable(), // null when nothing finished that period
})
export type TrendPoint = z.infer<typeof TrendPoint>

export const TrendResponse = z.object({
  interval: z.enum(["day", "week"]),
  points: z.array(TrendPoint),
})
export type TrendResponse = z.infer<typeof TrendResponse>

// ---------------------------------------------------------------------------
// Section 3 -- the small lookup calls
// ---------------------------------------------------------------------------

/** GET /api/filter-options */
export const FilterOptionsQuery = z.object({ team: teamId.optional() })
export type FilterOptionsQuery = z.infer<typeof FilterOptionsQuery>

export const FilterOptionsResponse = z.object({
  teams: z.array(idAndName),
  agentKinds: z.array(z.string()),
  engineers: z.array(idAndName),
})
export type FilterOptionsResponse = z.infer<typeof FilterOptionsResponse>

/** GET /api/teams -- no query to check. */
export const TeamListResponse = z.array(idAndName)
export type TeamListResponse = z.infer<typeof TeamListResponse>

// ---------------------------------------------------------------------------
// Section 4 -- the org and team screens
// ---------------------------------------------------------------------------

/** GET /api/metrics/summary -- query is `rangeFilter` from filters.ts. */
export const SummaryResponse = z.object({
  from: isoDateTime,
  to: isoDateTime,
  finishedTasks: z.number().int().nonnegative(),
  moneySpentCents: cents,
  defaults: z.object({
    hoursSavedPerTask: z.number().nonnegative(),
    engineerHourlyCostCents: cents,
  }),
})
export type SummaryResponse = z.infer<typeof SummaryResponse>

/** GET /api/metrics/adoption -- fixed 7d/30d windows, no date range. */
export const AdoptionQuery = z.object({ team: teamId.optional(), agentKind: agentKind.optional() })
export type AdoptionQuery = z.infer<typeof AdoptionQuery>

const adoptionRateWindow = z.object({
  activeEngineers: z.number().int().nonnegative(),
  licensedSeats: z.number().int().nonnegative(),
  rate,
})

export const AdoptionResponse = z.object({
  adoptionRate: z.object({ last7d: adoptionRateWindow, last30d: adoptionRateWindow }),
  depthOfUse: z.object({
    deep: z.number().int().nonnegative(),
    regular: z.number().int().nonnegative(),
    light: z.number().int().nonnegative(),
    dormant: z.number().int().nonnegative(),
    totalSeats: z.number().int().nonnegative(),
  }),
  stickingRate: z.object({
    activeInLast7d: z.number().int().nonnegative(),
    everRun: z.number().int().nonnegative(),
    rate,
  }),
})
export type AdoptionResponse = z.infer<typeof AdoptionResponse>

/** GET /api/metrics/outcomes -- query is `rangeFilter`; successRate ignores from/to. */
export const SuccessRateWindow = z.object({
  firstTry: z.object({
    successes: z.number().int().nonnegative(),
    endedRuns: z.number().int().nonnegative(),
    rate,
  }),
  eventual: z.object({
    succeededTasks: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
    rate,
  }),
  cancelledEarly: z.number().int().nonnegative(),
})
export type SuccessRateWindow = z.infer<typeof SuccessRateWindow>

export const OutcomesResponse = z.object({
  successRate: z.object({ last7d: SuccessRateWindow, last30d: SuccessRateWindow }),
  from: isoDateTime,
  to: isoDateTime,
  finishedTasks: z.number().int().nonnegative(),
  outputs: z.array(z.object({ kind: artifactKind, count: z.number().int().nonnegative() })),
  mergedPullRequests: z.number().int().nonnegative(),
  reworkRate: z.object({
    revertedOrRewritten: z.number().int().nonnegative(),
    totalMerged: z.number().int().nonnegative(),
    rate,
  }),
})
export type OutcomesResponse = z.infer<typeof OutcomesResponse>

/** GET /api/metrics/cost -- query is `rangeFilter`. */
export const CostResponse = z.object({
  from: isoDateTime,
  to: isoDateTime,
  costPerFinishedTask: z.object({
    medianCents: cents,
    averageCents: cents,
    worstCents: cents,
    finishedTasks: z.number().int().nonnegative(),
  }),
  tokensUsed: z.object({
    freshInput: z.number().int().nonnegative(),
    cachedInput: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    thinking: z.number().int().nonnegative(),
  }),
})
export type CostResponse = z.infer<typeof CostResponse>

/** GET /api/metrics/reliability -- query is `rangeFilter`; failureRate ignores from/to. */
export const FailureWindow = z.object({
  endedRuns: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  byBlame: z.array(z.object({ blame, count: z.number().int().nonnegative(), rate })),
  byCause: z.array(z.object({ cause: failureCause, count: z.number().int().nonnegative(), rate })),
})
export type FailureWindow = z.infer<typeof FailureWindow>

export const ReliabilityResponse = z.object({
  failureRate: z.object({ last7d: FailureWindow, last30d: FailureWindow }),
  from: isoDateTime,
  to: isoDateTime,
  quietFailures: z.object({ count: z.number().int().nonnegative(), rate }),
  retryRate: z.object({
    tasksNeedingRetry: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
    rate,
  }),
  timeBeforeGivingUp: z.object({
    p50Ms: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
  }),
})
export type ReliabilityResponse = z.infer<typeof ReliabilityResponse>

/** GET /api/metrics/speed -- query is `rangeFilter`. */
const percentilesMs = z.object({
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  p99Ms: z.number().nonnegative(),
})

export const SpeedResponse = z.object({
  from: isoDateTime,
  to: isoDateTime,
  turnTime: percentilesMs,
  runTime: percentilesMs,
  timedOutRuns: z.number().int().nonnegative(),
})
export type SpeedResponse = z.infer<typeof SpeedResponse>

/** GET /api/metrics/flags -- query is `rangeFilter`. */
export const FlagsSummaryResponse = z.object({
  from: isoDateTime,
  to: isoDateTime,
  bySeverity: z.array(z.object({ severity, count: z.number().int().nonnegative() })),
  byStatus: z.array(z.object({ status: disposition, count: z.number().int().nonnegative() })),
  dismissedExpectedRate: rate,
})
export type FlagsSummaryResponse = z.infer<typeof FlagsSummaryResponse>

/** GET /api/metrics/in-progress -- no date range, this is happening right now. */
export const InProgressQuery = z.object({ team: teamId.optional(), agentKind: agentKind.optional() })
export type InProgressQuery = z.infer<typeof InProgressQuery>

export const InProgressResponse = z.object({
  count: z.number().int().nonnegative(),
  costSoFarCents: cents,
})
export type InProgressResponse = z.infer<typeof InProgressResponse>

/** GET /api/flags -- rangeFilter's fields, plus severity/status/kind and paging. */
export const FlagListQuery = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    team: teamId.optional(),
    agentKind: agentKind.optional(),
    severity: severity.optional(),
    status: disposition.optional(),
    kind: policyFlagKind.optional(),
    ...pageFilterFields,
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to),
    team: input.team,
    agentKind: input.agentKind,
    severity: input.severity,
    status: input.status,
    kind: input.kind,
    limit: input.limit,
    offset: input.offset,
  }))
export type FlagListQuery = z.infer<typeof FlagListQuery>

export const FlagListItem = z.object({
  id: z.string(),
  runId: z.string(),
  kind: policyFlagKind,
  severity,
  status: disposition,
  isNewKindForScope: z.boolean(),
  createdAt: isoDateTime,
  // Which team this flag belongs to -- sent on every row, including a request already scoped to
  // one team, since a caller that already knows the answer can just ignore these two fields.
  teamId: z.string(),
  teamName: z.string(),
})
export type FlagListItem = z.infer<typeof FlagListItem>

export const FlagListResponse = page(FlagListItem)
export type FlagListResponse = z.infer<typeof FlagListResponse>

/**
 * GET /api/trend -- the org/team equivalent of the engineer's own `/trend` (section 6): the same
 * point shape, scoped by an optional team instead of one engineer. Leave `team` out for the
 * org-wide line, the org screen's "runs per week paired with success rate"; pass it for one
 * team's line, the team screen's daily mini-charts -- same team-optional convention as every
 * other org/team-shared call in this section.
 */
export const TrendQuery = z
  .object({
    team: teamId.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    interval: z.enum(["day", "week"]).default("week"),
    agentKind: agentKind.optional(),
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to, 90),
    team: input.team,
    interval: input.interval,
    agentKind: input.agentKind,
  }))
export type TrendQuery = z.infer<typeof TrendQuery>

// Response is `TrendResponse`, defined once, right after RunSummary above.

// ---------------------------------------------------------------------------
// Section 5 -- budgets
// ---------------------------------------------------------------------------

/** GET /api/budget-status */
export const BudgetStatusQuery = z
  .object({ team: teamId.optional(), month: monthString.optional() })
  .transform((input) => ({ team: input.team, month: input.month ?? currentUtcMonth() }))
export type BudgetStatusQuery = z.infer<typeof BudgetStatusQuery>

export const BudgetStatusResponse = z.object({
  scope: z.enum(["org", "team"]),
  teamId: z.string().nullable(),
  month: monthString,
  limitCents: cents,
  warnCents: cents,
  stopCents: cents,
  spentSoFarCents: cents,
  monthProgress: rate,
  projectedLandingCents: cents,
  warnLineCrossed: z.boolean(),
  stopLineCrossed: z.boolean(),
  // present only when scope is "org"
  teamsWithoutBudget: z.number().int().nonnegative().optional(),
  // One point per UTC calendar day of the month so far, month start through today, running
  // total -- what the team screen's burn chart draws its cumulative spend line from. The
  // warning/stop lines, today's marker, and the dashed projection to month end are all drawn
  // from the fields already above (warnCents/stopCents/projectedLandingCents); they are not
  // repeated per day here.
  dailySpend: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
      cumulativeSpentCents: cents,
    }),
  ),
})
export type BudgetStatusResponse = z.infer<typeof BudgetStatusResponse>

/** Shared by GET and PUT /api/teams/:teamId/budget. */
export const TeamIdParam = z.object({ teamId: z.string() })
export type TeamIdParam = z.infer<typeof TeamIdParam>

/** GET /api/teams/:teamId/budget */
export const TeamBudgetQuery = z
  .object({ month: monthString.optional() })
  .transform((input) => ({ month: input.month ?? currentUtcMonth() }))
export type TeamBudgetQuery = z.infer<typeof TeamBudgetQuery>

export const BudgetResponse = z.object({
  teamId: z.string(),
  month: monthString,
  limitCents: cents,
  warnCents: cents,
  stopCents: cents,
})
export type BudgetResponse = z.infer<typeof BudgetResponse>

/** The GET returns null (with a 404) when no budget is set yet for that team and month. */
export const TeamBudgetResponse = BudgetResponse.nullable()
export type TeamBudgetResponse = z.infer<typeof TeamBudgetResponse>

/**
 * PUT /api/teams/:teamId/budget -- the one write in the whole API. The one rule docs/api.md
 * enforces here is warnCents strictly below stopCents; it does not also require stopCents to sit
 * below limitCents the way docs/data-model.md's table CHECK does (that CHECK is looser too --
 * <=, not <). Worth reconciling: as written, a value with stopCents above limitCents passes this
 * schema and would only be caught by the raw database CHECK on insert, not with a clean 422.
 */
export const BudgetInput = z
  .object({
    month: monthString,
    limitCents: cents,
    warnCents: cents,
    stopCents: cents,
  })
  .refine((input) => input.stopCents <= input.limitCents, {
    message: "The stop line cannot sit above the limit.",
    path: ["stopCents"],
  })
  .refine((input) => input.warnCents < input.stopCents, {
    message: "The warning line has to sit below the stop line.",
    path: ["warnCents"],
  })
export type BudgetInput = z.infer<typeof BudgetInput>

/** GET /api/teams/:teamId/comparison */
export const ComparisonQuery = z
  .object({
    metric: z.enum(["firstTry", "eventual"]).default("firstTry"),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    agentKind: agentKind.optional(),
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to),
    metric: input.metric,
    agentKind: input.agentKind,
  }))
export type ComparisonQuery = z.infer<typeof ComparisonQuery>

export const ComparisonResponse = z.object({
  metric: z.enum(["firstTry", "eventual"]),
  team: z.object({ rate, runCount: z.number().int().nonnegative() }),
  org: z.object({ rate, runCount: z.number().int().nonnegative() }),
  band: z.object({ low: rate, high: rate }),
  withinBand: z.boolean(),
  note: z.string(),
})
export type ComparisonResponse = z.infer<typeof ComparisonResponse>

/**
 * GET /api/teams/comparison -- the org-wide sibling of the call just above: every team plotted
 * against the same band at once, for the org screen's "teams, compared fairly" scatter. An HTTP
 * router has to match the literal `comparison` path segment ahead of the `:teamId` wildcard on
 * `GET /api/teams/:teamId/comparison` for these two routes to coexist -- the same literal-before-
 * parameter rule every router already follows for routes like this.
 */
export const TeamsComparisonQuery = z
  .object({
    metric: z.enum(["firstTry", "eventual"]).default("firstTry"),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    agentKind: agentKind.optional(),
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to),
    metric: input.metric,
    agentKind: input.agentKind,
  }))
export type TeamsComparisonQuery = z.infer<typeof TeamsComparisonQuery>

export const TeamComparisonPoint = z.object({
  teamId: z.string(),
  teamName: z.string(),
  rate,
  runCount: z.number().int().nonnegative(),
  band: z.object({ low: rate, high: rate }), // sized to this team's own run count
  withinBand: z.boolean(),
})
export type TeamComparisonPoint = z.infer<typeof TeamComparisonPoint>

export const TeamsComparisonResponse = z.object({
  metric: z.enum(["firstTry", "eventual"]),
  from: isoDateTime,
  to: isoDateTime,
  org: z.object({ rate, runCount: z.number().int().nonnegative() }),
  teams: z.array(TeamComparisonPoint),
})
export type TeamsComparisonResponse = z.infer<typeof TeamsComparisonResponse>

// ---------------------------------------------------------------------------
// Section 6 -- the engineer screen
// ---------------------------------------------------------------------------

export const EngineerIdParam = z.object({ engineerId: z.string() })
export type EngineerIdParam = z.infer<typeof EngineerIdParam>

/** GET /api/engineers/:engineerId/overview -- defaults to a trailing 30 days. */
export const EngineerOverviewQuery = z
  .object({ from: isoDateTime.optional(), to: isoDateTime.optional(), agentKind: agentKind.optional() })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({ ...resolveDateRange(input.from, input.to), agentKind: input.agentKind }))
export type EngineerOverviewQuery = z.infer<typeof EngineerOverviewQuery>

export const EngineerOverviewResponse = z.object({
  engineerId: z.string(),
  from: isoDateTime,
  to: isoDateTime,
  finishedTasks: z.number().int().nonnegative(),
  successRate: z.object({
    firstTry: z.object({
      successes: z.number().int().nonnegative(),
      endedRuns: z.number().int().nonnegative(),
      rate,
    }),
    eventual: z.object({
      succeededTasks: z.number().int().nonnegative(),
      totalTasks: z.number().int().nonnegative(),
      rate,
    }),
  }),
  costPerFinishedTask: z.object({ medianCents: cents, averageCents: cents, worstCents: cents }),
  outputs: z.array(z.object({ kind: artifactKind, count: z.number().int().nonnegative() })),
  mergedPullRequests: z.number().int().nonnegative(),
  quietFailures: z.number().int().nonnegative(),
  depthOfUse: depthOfUseBucket,
})
export type EngineerOverviewResponse = z.infer<typeof EngineerOverviewResponse>

/** GET /api/engineers/:engineerId/trend -- defaults to a trailing 90 days. */
export const EngineerTrendQuery = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    interval: z.enum(["day", "week"]).default("week"),
    agentKind: agentKind.optional(),
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to, 90),
    interval: input.interval,
    agentKind: input.agentKind,
  }))
export type EngineerTrendQuery = z.infer<typeof EngineerTrendQuery>

// Same point shape as GET /api/trend's response (section 4) -- see `TrendResponse`, defined once
// right after RunSummary above, for why this is an alias rather than its own object literal.
export const EngineerTrendResponse = TrendResponse
export type EngineerTrendResponse = z.infer<typeof EngineerTrendResponse>

/** GET /api/engineers/:engineerId/runs -- same shape as RunSummary, teamId/engineerId dropped. */
export const EngineerRunsQuery = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    status: runStatus.optional(),
    agentKind: agentKind.optional(),
    ...pageFilterFields,
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to),
    status: input.status,
    agentKind: input.agentKind,
    limit: input.limit,
    offset: input.offset,
  }))
export type EngineerRunsQuery = z.infer<typeof EngineerRunsQuery>

export const EngineerRunSummary = RunSummary.omit({ teamId: true, engineerId: true })
export type EngineerRunSummary = z.infer<typeof EngineerRunSummary>

export const EngineerRunsResponse = page(EngineerRunSummary)
export type EngineerRunsResponse = z.infer<typeof EngineerRunsResponse>

// ---------------------------------------------------------------------------
// Section 7 -- runs: search, and the full detail
// ---------------------------------------------------------------------------

/** GET /api/runs -- rangeFilter's fields, plus engineer/status/blame and paging. */
export const RunsQuery = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    team: teamId.optional(),
    agentKind: agentKind.optional(),
    engineer: z.string().optional(),
    status: runStatus.optional(),
    blame: blame.optional(),
    ...pageFilterFields,
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to),
    team: input.team,
    agentKind: input.agentKind,
    engineer: input.engineer,
    status: input.status,
    blame: input.blame,
    limit: input.limit,
    offset: input.offset,
  }))
export type RunsQuery = z.infer<typeof RunsQuery>

export const RunsResponse = page(RunSummary)
export type RunsResponse = z.infer<typeof RunsResponse>

/** GET /api/runs/:runId -- 404 if the id matches nothing. */
export const RunIdParam = z.object({ runId: z.string() })
export type RunIdParam = z.infer<typeof RunIdParam>

export const TaskAttempt = z.object({
  runId: z.string(),
  attemptNumber: z.number().int().positive(),
  status: runStatus,
  startedAt: isoDateTime,
  totalCostCents: cents,
  isSelf: z.boolean(),
  // Why this attempt ended the way it did, when it didn't succeed -- both already exist on the
  // underlying run (see docs/data-model.md's runs.failure_cause / runs.blame). Null for an
  // attempt that's still running, succeeded, or was cancelled, same rule as the run itself.
  failureCause: failureCause.nullable(),
  blame: blame.nullable(),
})
export type TaskAttempt = z.infer<typeof TaskAttempt>

export const RunTurn = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
  model: z.string(),
  freshInputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  thinkingTokens: z.number().int().nonnegative(),
  toolSeconds: z.number().nonnegative(),
  costCents: cents,
})
export type RunTurn = z.infer<typeof RunTurn>

export const RunToolCall = z.object({
  id: z.string(),
  turnId: z.string(),
  name: z.string(),
  startedAt: isoDateTime,
  durationMs: z.number().int().nonnegative(),
  outcome: toolCallOutcome,
  summary: z.string(),
})
export type RunToolCall = z.infer<typeof RunToolCall>

export const RunArtifact = z.object({
  id: z.string(),
  kind: artifactKind,
  url: z.string().nullable(),
  merged: z.boolean().nullable(),
  createdAt: isoDateTime,
})
export type RunArtifact = z.infer<typeof RunArtifact>

export const RunPolicyFlag = z.object({
  id: z.string(),
  // Which turn this flag ties to, when it ties to one specific model reply rather than the run
  // as a whole -- carried straight through from `policy_flags.turn_id` (docs/data-model.md).
  // Nullable because not every flag can be placed this precisely: some rules (a spend cap
  // crossed, say) are properties of the run as a whole, with no single turn responsible, so the
  // database itself allows this column to be null rather than forcing a guess at a turn. A null
  // here is exactly what keeps a flag in the run-level card only, with nowhere on the
  // turn-by-turn breakdown to place it.
  turnId: z.string().nullable(),
  kind: policyFlagKind,
  severity,
  status: disposition,
  detail: z.string(),
  createdAt: isoDateTime,
})
export type RunPolicyFlag = z.infer<typeof RunPolicyFlag>

export const RunDetailResponse = RunSummary.extend({
  taskAttempts: z.array(TaskAttempt),
  turns: z.array(RunTurn),
  toolCalls: z.array(RunToolCall),
  artifacts: z.array(RunArtifact),
  policyFlags: z.array(RunPolicyFlag),
})
export type RunDetailResponse = z.infer<typeof RunDetailResponse>

// Query schemas for the calls that take exactly the shared filter set are not repeated here --
// GET /api/metrics/summary, /outcomes, /cost, /reliability, /speed, and /flags (metrics) all use
// `rangeFilter` from filters.ts directly.
