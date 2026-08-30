import { CartesianGrid, Line, LineChart as RLineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { tooltipProps, useThemeColors } from "../charts/theme.ts"

// A small, reusable trend line -- used for every "own history" and "last N weeks" chart across
// the four screens (docs/ui.md: "Anything over time -> Line chart, or a sparkline where it is
// small"). One component, several callers, rather than a bespoke chart per screen.
//
// Recharts, not hand-rolled SVG: `width`/`height` now only set the chart's aspect ratio (via a
// wrapper with `aspect-ratio` CSS) -- the actual rendered element is always fluid at 100% of its
// container, same as the plain SVG this replaces. Series are assumed equal length, which every
// current caller satisfies.

export type LineSeries = {
  key: string
  colorVar: string
  points: number[]
  dashed?: boolean
}

export function LineChart({
  series,
  width = 300,
  height = 90,
  showBaseline = true,
  xLabels,
  referenceValue,
  referenceLabel,
  endLabel,
  ariaLabel,
}: {
  series: LineSeries[]
  width?: number
  height?: number
  showBaseline?: boolean
  xLabels?: [string, string]
  referenceValue?: number
  referenceLabel?: string
  /** Formats the last point of each series into a label drawn beside its end-dot. */
  endLabel?: (series: LineSeries) => string
  ariaLabel: string
}) {
  const colors = useThemeColors({
    borderStrong: "var(--border-strong)",
    inkFaint: "var(--ink-faint)",
    surface: "var(--surface)",
    border: "var(--border)",
    ink: "var(--ink)",
    inkSoft: "var(--ink-soft)",
  })
  const seriesColors = useThemeColors(Object.fromEntries(series.map((s) => [s.key, s.colorVar])))

  const n = Math.max(...series.map((s) => s.points.length), 1)
  const lastIndex = n - 1
  const data = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number> = { i }
    for (const s of series) row[s.key] = s.points[i]!
    return row
  })

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", aspectRatio: `${width} / ${height}` }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={data} margin={{ top: endLabel ? 14 : 6, right: endLabel ? 56 : 8, bottom: 2, left: 4 }}>
          <CartesianGrid stroke={colors.border} horizontal vertical={false} />
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, Math.max(lastIndex, 1)]}
            ticks={xLabels ? [0, lastIndex] : []}
            tick={xLabels ? { fill: colors.inkFaint, fontSize: 9.5 } : false}
            tickFormatter={(i: number) => (xLabels ? (i === 0 ? xLabels[0] : xLabels[1]) : "")}
            axisLine={showBaseline ? { stroke: colors.borderStrong } : false}
            tickLine={false}
            height={xLabels ? 18 : 4}
            interval={0}
          />
          <YAxis
            hide
            domain={[
              (min: number) => Math.min(min, referenceValue ?? min),
              (max: number) => Math.max(max, referenceValue ?? max),
            ]}
          />
          <Tooltip {...tooltipProps(colors)} labelFormatter={() => ""} isAnimationActive={false} />

          {referenceValue !== undefined && (
            <ReferenceLine
              y={referenceValue}
              ifOverflow="extendDomain"
              stroke={colors.inkFaint}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={referenceLabel ? { value: referenceLabel, position: "insideTopRight", fill: colors.inkFaint, fontSize: 9 } : undefined}
            />
          )}

          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="linear"
              stroke={seriesColors[s.key]}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: seriesColors[s.key], stroke: colors.surface, strokeWidth: 1.5 }}
            />
          ))}

          {series.map((s) => {
            const lastValue = s.points[s.points.length - 1]
            if (lastValue === undefined) return null
            return (
              <ReferenceDot
                key={`${s.key}-end`}
                x={s.points.length - 1}
                y={lastValue}
                r={3.5}
                fill={seriesColors[s.key]}
                stroke={colors.surface}
                strokeWidth={1.5}
                isFront
                ifOverflow="extendDomain"
                label={endLabel ? { value: endLabel(s), position: "right", offset: 6, fill: seriesColors[s.key], fontSize: 11 } : undefined}
              />
            )
          })}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  )
}
