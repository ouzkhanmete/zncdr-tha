// Turns one `RunSummary` (docs/api.md section 7) into exactly what a "recent runs" row needs to
// show, so a reader can tell one run from another without opening it: when it ran, what it was
// asked to do, who ran it, how it ended, what it produced, what it cost, how long it took. Kept
// as a plain function, not a component, so the logic can be tested without rendering anything --
// see runRow.test.ts for the edge cases (a failed run, one still running, one with no artifact,
// one with no engineer because automation started it).

import type { RunStatus, RunSummary } from "@app/shared"
import { formatDuration, formatUtcDate, formatUtcTime } from "../lib/format.ts"
import { formatDollarsAndCents } from "../lib/money.ts"

// Only "succeeded"/"failed" have a fixed emoji in docs/ui.md's vocabulary table. Inventing one
// for "running"/"cancelled"/"timed out" would be decoration, not a word replaced -- so those
// three fall through to a plain word instead (below).
const OUTCOME_EMOJI: Partial<Record<RunStatus, string>> = { succeeded: "✅", failed: "❌" }

// Plain words, not the raw status string -- "timed_out" is a column value, not something to show
// a person. See docs/ui.md's "Plain words only."
const OUTCOME_LABEL: Record<RunStatus, string> = {
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  timed_out: "timed out",
  running: "running",
}

const OUTPUT_EMOJI: Record<string, string> = { pull_request: "🔀", commit: "💾", file: "📄", report: "📊" }

export type RunRow = {
  id: string
  runId: string
  whenLabel: string
  taskSummary: string
  engineerLabel: string
  teamLabel: string | null
  outcomeEmoji: string | null
  outcomeLabel: string
  outputEmoji: string | null
  costLabel: string
  durationLabel: string
}

/**
 * `engineerName`/`teamName` are resolved separately, from `lib/directory.ts` -- a `RunSummary`
 * only ever carries ids, never names (docs/api.md: "An id is a short string"). Leave `teamName`
 * out entirely when the caller already scoped its request to one team and has no use for it on
 * every row -- same convention as `FlagsTable`'s optional `teamNameFor`.
 */
export function buildRunRow(run: RunSummary, names: { engineerName?: string | null; teamName?: string | null } = {}): RunRow {
  return {
    id: run.id,
    runId: run.id,
    whenLabel: `${formatUtcDate(run.startedAt)} · ${formatUtcTime(run.startedAt)}`,
    taskSummary: run.taskSummary,
    // `engineerId === null` means automation started it (docs/api.md), not a name lookup that
    // came back empty -- those two are told apart here so automation never gets a placeholder
    // dash that reads like missing data.
    engineerLabel: run.engineerId === null ? "Automation" : (names.engineerName ?? "—"),
    teamLabel: names.teamName ?? null,
    outcomeEmoji: OUTCOME_EMOJI[run.status] ?? null,
    outcomeLabel: OUTCOME_LABEL[run.status],
    outputEmoji: run.primaryOutputKind ? (OUTPUT_EMOJI[run.primaryOutputKind] ?? null) : null,
    costLabel: formatDollarsAndCents(run.totalCostCents),
    // Only a still-running run has no duration (docs/api.md: durationMs is null exactly when
    // finishedAt is) -- everything else, failed or cancelled included, has a real number.
    durationLabel: run.durationMs !== null ? formatDuration(run.durationMs) : "still running",
  }
}
