import type { BudgetStatusResponse } from "@app/shared"
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { tooltipProps, useThemeColors } from "../charts/theme.ts"
import { dayOfMonth, daysInMonth, daysUntilStopLine } from "../lib/budget.ts"
import { formatDollarsWhole } from "../lib/money.ts"

// The team page's budget burn chart: cumulative spend by day of month, with the warning and stop
// lines overlaid and a dashed projection to month end at today's pace. Percent-used alone can't
// tell day 10 from day 28 apart -- this can. See docs/ui.md's team page section 1 and
// docs/metrics.md's "Budget and burn pace."
//
// This is the widest chart on either page (day-by-day over a whole month, three reference lines,
// their labels) -- shrinking it to fit a narrow screen the way the other charts do would crowd
// those labels into each other. So instead of scaling down, it holds a legible minimum width and
// scrolls sideways inside its own container -- see docs/ui.md: "wide ones scroll inside their own
// container rather than making the page scroll sideways."

const HEIGHT = 220
const MIN_WIDTH = 860

export function BudgetBurnChart({ status }: { status: BudgetStatusResponse }) {
  const totalDaysInMonth = daysInMonth(status.month)
  const daysToStop = daysUntilStopLine(status.spentSoFarCents, status.monthProgress, totalDaysInMonth, status.stopCents)
  const dailySpend = status.dailySpend.map((p) => ({ day: dayOfMonth(p.date), cumulativeCents: p.cumulativeSpentCents }))

  const colors = useThemeColors({
    accent: "var(--accent)",
    bad: "var(--bad)",
    warn: "var(--warn)",
    borderStrong: "var(--border-strong)",
    inkFaint: "var(--ink-faint)",
    inkSoft: "var(--ink-soft)",
    ink: "var(--ink)",
    surface: "var(--surface)",
    border: "var(--border)",
  })

  const todayDayOfMonth = Math.round(status.monthProgress * totalDaysInMonth)
  const yMax = Math.max(status.limitCents, status.projectedLandingCents) * 1.08
  const lastPoint = dailySpend[dailySpend.length - 1]!
  const overStop = status.stopLineCrossed
  const overStopDay = dailySpend.find((p) => p.cumulativeCents >= status.stopCents)

  // One data row per actual day, plus a `projection` field defined only at the last actual day and
  // at month end -- `connectNulls` on that line then draws a single straight dashed segment
  // between those two points, skipping over every day in between without a value.
  const data: Array<{ day: number; spentCents: number | null; projectedCents: number | null }> = dailySpend.map((p) => ({
    day: p.day,
    spentCents: p.cumulativeCents,
    projectedCents: null,
  }))
  data[data.length - 1]!.projectedCents = lastPoint.cumulativeCents
  if (lastPoint.day !== totalDaysInMonth) {
    data.push({ day: totalDaysInMonth, spentCents: null, projectedCents: status.projectedLandingCents })
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ position: "relative", minWidth: MIN_WIDTH }}>
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 8,
            fontSize: 12.5,
            fontWeight: 700,
            color: overStop ? colors.bad : colors.ink,
            textAlign: "right",
          }}
        >
          projected {formatDollarsWhole(status.projectedLandingCents)} by day {totalDaysInMonth}
          {daysToStop !== null && daysToStop > 0 ? ` · ${daysToStop}d to stop line` : ""}
        </div>

        <div
          role="img"
          aria-label={`Cumulative spend by day of month. Spent ${formatDollarsWhole(status.spentSoFarCents)} of a ${formatDollarsWhole(status.limitCents)} limit through day ${todayDayOfMonth} of ${totalDaysInMonth}. At this pace, month end lands at ${formatDollarsWhole(status.projectedLandingCents)}.`}
          style={{ height: HEIGHT }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 34, right: 30, bottom: 8, left: 10 }}>
              <CartesianGrid stroke={colors.border} horizontal vertical={false} />
              <XAxis
                dataKey="day"
                type="number"
                domain={[1, totalDaysInMonth]}
                ticks={[1, totalDaysInMonth]}
                tickFormatter={(d: number) => `day ${d}`}
                tickLine={false}
                axisLine={{ stroke: colors.borderStrong }}
                tick={{ fill: colors.inkFaint, fontSize: 10.5 }}
              />
              <YAxis hide domain={[0, Math.round(yMax)]} />
              <Tooltip
                {...tooltipProps(colors)}
                labelFormatter={(d: number) => `day ${d}`}
                formatter={(value: number, name: string) => [formatDollarsWhole(value), name === "projectedCents" ? "Projected" : "Spent"]}
              />

              {/* Recharts' reference-line label positions describe where the line sits against
                  the label's own box, not the other way round: "insideBottomRight" presses the
                  label's bottom edge to the line (so it reads *above* it), and "insideTopRight"
                  presses the top edge to the line (reads *below*). Stop sits above warn here, so
                  each label is pushed away from the other, into the free space beyond its line --
                  otherwise, when the two dollar values are close together (as they are for a team
                  already over its stop line), the labels collide in the narrow gap between them. */}
              <ReferenceLine y={status.stopCents} stroke={colors.bad} strokeWidth={1.5} label={{ value: `stop · ${formatDollarsWhole(status.stopCents)}`, position: "insideBottomRight", fill: colors.bad, fontSize: 11 }} />
              <ReferenceLine
                y={status.warnCents}
                stroke={colors.warn}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={{ value: `warning · ${formatDollarsWhole(status.warnCents)}`, position: "insideTopRight", fill: colors.warn, fontSize: 11 }}
              />
              <ReferenceLine
                x={todayDayOfMonth}
                stroke={colors.inkFaint}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                label={{ value: `today · day ${todayDayOfMonth} of ${totalDaysInMonth}`, position: "top", fill: colors.inkSoft, fontSize: 11 }}
              />

              <Line dataKey="spentCents" stroke={colors.accent} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls activeDot={{ r: 4, fill: colors.accent, stroke: colors.surface, strokeWidth: 1.5 }} />
              <Line dataKey="projectedCents" stroke={colors.accent} strokeWidth={2.5} strokeDasharray="6 4" strokeOpacity={0.75} dot={false} isAnimationActive={false} connectNulls activeDot={false} />

              <ReferenceDot
                x={lastPoint.day}
                y={lastPoint.cumulativeCents}
                r={4.5}
                fill={colors.accent}
                stroke={colors.surface}
                strokeWidth={1.5}
                isFront
                label={{ value: formatDollarsWhole(lastPoint.cumulativeCents), position: "top", fill: colors.ink, fontSize: 11.5, fontWeight: 700 }}
              />
              {overStop && overStopDay && (
                <ReferenceDot
                  x={overStopDay.day}
                  y={overStopDay.cumulativeCents}
                  r={4}
                  fill={colors.bad}
                  stroke={colors.surface}
                  strokeWidth={1.5}
                  isFront
                  label={{ value: `crossed stop line, day ${overStopDay.day}`, position: "bottom", fill: colors.bad, fontSize: 10.5 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
