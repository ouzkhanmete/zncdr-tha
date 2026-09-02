// Every fixed fact about the imaginary org, straight out of docs/seed-data.md. Kept apart from
// the generator itself so the story (who, how many, since when) is easy to check against the
// doc without wading through generation logic.

export const DEFAULT_SEED = 42

export const TOTAL_DAYS = 180

export const DAY_MS = 24 * 60 * 60 * 1000

// "Today", truncated to UTC midnight -- the one moment every date in the seed is anchored to.
const now = new Date()
const TODAY_UTC_MS = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

// Day 1 of the org's history. Day 180 is always today: a rolling anchor, not a fixed calendar
// date, so `bun run seed` never goes stale. It used to be pinned to 2026-03-02 specifically so
// day 180 landed late in a month (28 August 2026) -- but a fixed date only stays "late in a
// month" until the real calendar catches up to it. Once it did, GET /api/budget-status (which
// always asks for the real current month) found a budgets table stamped with a month that had
// already passed, and the org page's budget table rendered empty. See docs/seed-data.md.
export const ORG_START_MS = TODAY_UTC_MS - (TOTAL_DAYS - 1) * DAY_MS

export function dateForDay(day: number): Date {
  return new Date(ORG_START_MS + (day - 1) * DAY_MS)
}

/** ISO 8601 UTC, second precision, no milliseconds -- the exact form docs/data-model.md shows. */
export function toIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function isWeekend(day: number): boolean {
  const dow = dateForDay(day).getUTCDay()
  return dow === 0 || dow === 6
}

export interface TeamConfig {
  readonly name: string
  readonly engineers: number
  /** First day (1-indexed) this team has any activity at all. */
  readonly adoptionDay: number
  /** Share of this team's seats that never run anything, ever. */
  readonly dormantRate: number
  /** Multiplies every non-dormant engineer's usage rate for this team. 1.0 is baseline. */
  readonly usageIntensity: number
}

// Engineer counts sum to exactly 130, matching orgs.licensed_seats.
export const TEAMS: readonly TeamConfig[] = [
  { name: "Comet", engineers: 3, adoptionDay: 1, dormantRate: 0.06, usageIntensity: 1.9 },
  { name: "Anchor", engineers: 40, adoptionDay: 1, dormantRate: 0.07, usageIntensity: 1.0 },
  { name: "Lighthouse", engineers: 6, adoptionDay: 1, dormantRate: 0.08, usageIntensity: 1.0 },
  { name: "Foundry", engineers: 18, adoptionDay: 55, dormantRate: 0.15, usageIntensity: 1.0 },
  { name: "Beacon", engineers: 12, adoptionDay: 70, dormantRate: 0.18, usageIntensity: 1.0 },
  { name: "Atlas", engineers: 22, adoptionDay: 95, dormantRate: 0.2, usageIntensity: 1.15 },
  { name: "Nova", engineers: 15, adoptionDay: 130, dormantRate: 0.28, usageIntensity: 1.4 },
  { name: "Pinnacle", engineers: 14, adoptionDay: 165, dormantRate: 0.6, usageIntensity: 1.0 },
]

// The month the budgets table holds "this month's" numbers for -- the real calendar month day
// 180 (today) falls in. Matches `currentUtcMonth()` in packages/shared/src/api.ts, which is what
// GET /api/budget-status resolves to whenever no month is given. Everything before month start
// is history; nothing exists after day 180.
export const CURRENT_MONTH = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
export const CURRENT_MONTH_START_MS = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
// Exclusive upper bound: the instant right after day 180 ends.
export const DATA_END_MS = ORG_START_MS + TOTAL_DAYS * DAY_MS

// How many days the current real calendar month has in total (28-31) -- used to turn a team's
// typical daily spend into "what a full month of that would cost," instead of a monthly budget
// that shrinks to match however little of the month has actually happened. See the note on
// generateBudgets in generate/budgets.ts for the bug this was pulled out to fix.
export const DAYS_IN_CURRENT_MONTH = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()

// How many days of the current calendar month have actually happened by day 180 (today) -- 1 on
// the 1st of a month, up to 31. This can be very small, which is exactly the situation the
// rolling anchor above exists to make look alive rather than empty (see docs/seed-data.md).
const ELAPSED_DAYS_THIS_MONTH = now.getUTCDate()

// Nova's "rough week" -- the week its spend crosses its stop line and about a dozen high
// severity flags land, all in the same few days. Has to fall inside both Nova's active window
// (day 130+) and the current month the budgets table reports on -- and the current month can now
// be as short as a single day, so a fixed day-160-166 offset from day 180 can no longer be
// trusted to land inside it.
//
// Sized to whatever has actually elapsed this month instead: a real week (or less, if the month
// itself is younger than a week), followed by up to two calmer weeks of recovery before day 180
// -- but never claiming more of either than the month has actually had. Run this on the 28th of
// a 28-day month and it reproduces the original 160-166 exactly; run it on the 2nd and the "week"
// is just today and yesterday with no room left for recovery -- which is the more honest story
// anyway (a team that burned its whole month in two days), not a worse one.
const NOVA_BAD_WEEK_LENGTH = Math.min(7, ELAPSED_DAYS_THIS_MONTH)
const NOVA_RECOVERY_DAYS = Math.min(14, ELAPSED_DAYS_THIS_MONTH - NOVA_BAD_WEEK_LENGTH)
export const NOVA_BAD_WEEK_END_DAY = TOTAL_DAYS - NOVA_RECOVERY_DAYS
export const NOVA_BAD_WEEK_START_DAY = NOVA_BAD_WEEK_END_DAY - NOVA_BAD_WEEK_LENGTH + 1 // inclusive

// Nova and Atlas's budget story is named to the dollar in docs/seed-data.md, so their limits
// and this-month spend targets are fixed constants rather than derived like every other team's.
export const NOVA_BUDGET = { limitCents: 180_000, targetSpentCents: 207_000 }
export const ATLAS_BUDGET = { limitCents: 400_000, targetSpentCents: 315_000 }

// The one engineer whose team changes mid-window -- proof that runs.team_id is really stamped at
// run time, not looked up through the engineer (see docs/data-model.md's callout on
// runs.team_id), and the case the engineer screen's "old team keeps its history" acceptance
// scenario needs to be walkable at all. Both teams have been active since day 1, so there's a
// full history of real runs on each side of the move -- not a token blip on either end.
export const TEAM_MOVE = {
  fromTeam: "Anchor",
  toTeam: "Lighthouse",
  // First day (1-indexed) a run counts toward the new team; every earlier run keeps the old
  // team's id. Roughly the midpoint of the 180-day window, so both sides get months of history.
  moveDay: 91,
} as const

// Pinnacle is barely started (day 165) -- by day 180 every day of its short history still falls
// inside the "first 30 days" org-setup-heavy window from the failure-cause story below, which
// makes it the one team where that regime is still what the last-30-days chart shows. To make
// that visible rather than just theoretically true, Pinnacle's runs fail a little more often
// than the org baseline while it's finding its footing, and most of those org-setup failures
// repeat the same missing credential rather than spreading across all five causes -- a real team
// stuck on one thing, not a smear.
export const NEW_TEAM_STRUGGLE = {
  teamName: "Pinnacle",
  /** Only applies while the team is inside its first-30-days org-setup-heavy window. */
  failProbMultiplier: 2.5,
} as const

export const DOMINANT_FAILURE_TEAM = "Pinnacle"
export const DOMINANT_FAILURE_CAUSE = "missing_secret_or_login"
// Chance an org-setup failure on that team repeats the same cause, rather than being drawn
// uniformly from all five -- high enough to clear the team screen's 50%-of-org-setup-failures
// callout with room to spare, short of 100% because a team hitting the exact same wall every
// single time, with no variation at all, is the "synthetic spike" this is meant to avoid.
export const DOMINANT_FAILURE_SHARE = 0.75

export const REPOS = [
  "web-app",
  "api-service",
  "infra",
  "mobile-app",
  "data-pipeline",
  "internal-tools",
] as const

export const AGENT_KINDS_WITH_REPO = [
  "code-fix",
  "feature-build",
  "test-write",
  "refactor",
  "dependency-bump",
] as const

export const AGENT_KINDS_NO_REPO = ["triage", "report"] as const

// Short, one-line task descriptions, sampled per agent kind -- what fills runs.task_summary.
// Deliberately short and generic, never the full task text a real prompt would carry -- see
// docs/data-model.md's callout on why the full text is never stored.
export const TASK_SUMMARIES_BY_AGENT_KIND: Readonly<Record<string, readonly string[]>> = {
  "code-fix": [
    "Fix flaky checkout test",
    "Patch null pointer in order lookup",
    "Fix off-by-one in pagination",
    "Resolve race condition in session refresh",
    "Fix timezone bug in report scheduler",
    "Fix incorrect rounding on refunds",
  ],
  "feature-build": [
    "Add CSV export to reports page",
    "Build rate limiter for public API",
    "Add dark mode toggle to settings",
    "Build retry queue for failed webhooks",
    "Add bulk-invite flow for teams",
    "Add pagination to the audit log",
  ],
  "test-write": [
    "Write tests for refund reconciliation job",
    "Add coverage for auth middleware",
    "Write integration tests for billing webhook",
    "Add tests for currency rounding",
    "Cover edge cases in search ranking",
    "Add regression test for login lockout",
  ],
  refactor: [
    "Refactor payment webhook handler",
    "Simplify onboarding state machine",
    "Extract shared validation into one module",
    "Clean up duplicated retry logic",
    "Split monolithic billing service",
    "Rename legacy fields across the API",
  ],
  "dependency-bump": [
    "Bump lodash to patch CVE",
    "Update React to latest minor",
    "Upgrade database driver",
    "Bump Node runtime version",
    "Update test framework major version",
    "Upgrade image processing library",
  ],
  triage: [
    "Investigate duplicate charge on card decline",
    "Diagnose slow query in billing report",
    "Look into intermittent 500s on checkout",
    "Investigate stuck jobs in the queue",
    "Find cause of missing webhook deliveries",
    "Triage spike in failed logins",
  ],
  report: [
    "Draft report on stale webhook subscriptions",
    "Summarize this week's flaky tests",
    "Report on API error rate trend",
    "Summarize dependency vulnerabilities",
    "Report on slow endpoints this month",
    "Summarize this month's spend by team",
  ],
} as const

// Fallback for any agent kind not covered above -- keeps the generator working even if
// AGENT_KINDS_WITH_REPO / AGENT_KINDS_NO_REPO grow a kind before this list catches up.
export const DEFAULT_TASK_SUMMARIES: readonly string[] = ["Handle the assigned task"]

export const TOOL_NAMES = [
  "bash",
  "file_edit",
  "code_search",
  "git",
  "package_installer",
  "web_search",
  "test_runner",
  "browser",
] as const

// Tools billed by the second, at a flat cents-per-hour rate -- everything else is free, per the
// callout in docs/data-model.md ("we keep no hourly rate table for tools... a free tool costs
// zero"). These two rates only live here, in the seed, standing in for whatever a real billing
// system would report per call.
export const METERED_TOOL_RATES_CENTS_PER_HOUR: Record<string, number> = {
  test_runner: 36,
  browser: 72,
}

export const ERROR_TYPES = [
  "command_failed",
  "not_found",
  "permission_denied",
  "syntax_error",
  "network_error",
] as const

// First and last name pools, combined to make 130 plausible, unique, entirely made-up people.
export const FIRST_NAMES = [
  "Priya",
  "James",
  "Wei",
  "Fatima",
  "Lucas",
  "Amara",
  "Sofia",
  "Noah",
  "Yuki",
  "Omar",
  "Elena",
  "Kwame",
  "Mia",
  "Arjun",
  "Chloe",
  "Diego",
  "Ingrid",
  "Hiro",
  "Zainab",
  "Liam",
  "Nadia",
  "Marcus",
  "Aisha",
  "Felix",
  "Rin",
  "Tomas",
  "Grace",
  "Bilal",
  "Freya",
  "Sam",
] as const

export const LAST_NAMES = [
  "Nair",
  "Okafor",
  "Chen",
  "Garcia",
  "Novak",
  "Haddad",
  "Larsson",
  "Kim",
  "Silva",
  "Petrov",
  "Kowalski",
  "Yamada",
  "Osei",
  "Rossi",
  "Dubois",
  "Ibrahim",
  "Costa",
  "Nakamura",
  "Singh",
  "Berg",
  "Mendez",
  "Adeyemi",
  "Novotny",
  "Farrell",
  "Andersson",
  "Reyes",
  "Kaur",
  "Volkov",
  "Abara",
  "Lindqvist",
] as const

// Common home timezones for a distributed but US/EU-leaning org. Purely informational per
// docs/data-model.md's note on `actor_utc_offset_minutes` -- the working-hours clustering in
// docs/seed-data.md is anchored to UTC directly, not to any one person's local day.
export const ENGINEER_UTC_OFFSETS_MINUTES = [-480, -420, -300, -240, 0, 60, 120, 330, 480] as const
