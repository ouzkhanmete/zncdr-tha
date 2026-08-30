// Pure helpers for `TeamComparisonScatter`'s bars -- pulled out of the component so the direction
// call and the tooltip text can be unit tested without rendering anything.

import type { TeamComparisonPoint } from "@app/shared"
import { formatPercent } from "../lib/format.ts"

/**
 * Which side of the expected range a team's rate falls on. `withinBand` (server-computed) is
 * still the single source of truth for *whether* a team gets called out; this only decides which
 * of two directions to say and to colour it, by re-reading that same server-provided `band` --
 * never a second, locally-invented threshold.
 */
export type ComparisonDirection = "below" | "in" | "above"

export function bandDirection(row: Pick<TeamComparisonPoint, "rate" | "band">): ComparisonDirection {
  if (row.rate < row.band.low) return "below"
  if (row.rate > row.band.high) return "above"
  return "in"
}

export interface TeamComparisonTooltipLines {
  teamName: string
  summary: string
  expected: string
  /** Only set when the team is outside its band -- null for a plain in-band row. */
  callout: string | null
}

/**
 * Builds the tooltip's text straight from one team's own row. Returns `null` for anything that
 * isn't a real, complete row -- rather than print "NaN%" the way the old scatter's tooltip could
 * when Recharts handed it a different series' datum by shared hover index (see this file's
 * sibling `TeamComparisonScatter.tsx` for that history). A bar chart's tooltip always reads off
 * the one row under the cursor, so this should never actually see a malformed row in practice --
 * this is a defensive backstop, not a fix for a bug that can still happen here.
 */
export function buildTeamComparisonTooltip(row: Partial<TeamComparisonPoint> | null | undefined): TeamComparisonTooltipLines | null {
  if (!row || !row.teamName) return null
  if (typeof row.rate !== "number" || !Number.isFinite(row.rate)) return null
  if (typeof row.runCount !== "number" || !Number.isFinite(row.runCount)) return null
  if (!row.band || typeof row.band.low !== "number" || typeof row.band.high !== "number") return null

  const direction = bandDirection({ rate: row.rate, band: row.band })
  return {
    teamName: row.teamName,
    summary: `${formatPercent(row.rate)} success over ${row.runCount} runs`,
    expected: `expected ${formatPercent(row.band.low)}–${formatPercent(row.band.high)} for a team this size`,
    callout: direction === "in" ? null : `${direction} the expected range`,
  }
}
