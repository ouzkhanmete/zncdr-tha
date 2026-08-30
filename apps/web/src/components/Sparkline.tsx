import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, YAxis } from "recharts"
import { tooltipProps, useThemeColors } from "../charts/theme.ts"

// The smallest trend shape: a grey line with one accent dot marking "now." Used wherever a stat
// needs a trend but a full axis-and-labels chart would be more chrome than the card has room for
// -- see docs/ui.md: "a sparkline where it is small." No axis, no gridlines, on purpose -- this is
// a glyph, not a chart -- but it still gets a hover tooltip so the exact value is a mouseover away.
export function Sparkline({
  points,
  width = 100,
  height = 34,
  lineColorVar = "var(--border-strong)",
  dotColorVar = "var(--accent)",
  ariaLabel,
}: {
  points: number[]
  width?: number
  height?: number
  lineColorVar?: string
  dotColorVar?: string
  ariaLabel: string
}) {
  const colors = useThemeColors({
    line: lineColorVar,
    dot: dotColorVar,
    surface: "var(--surface)",
    border: "var(--border)",
    ink: "var(--ink)",
    inkSoft: "var(--ink-soft)",
  })
  const data = points.map((v, i) => ({ i, v }))
  const lastIndex = points.length - 1
  const lastValue = points[lastIndex]

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", aspectRatio: `${width} / ${height}`, marginTop: 6 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            {...tooltipProps(colors)}
            cursor={false}
            isAnimationActive={false}
            labelFormatter={() => ""}
            formatter={(value: number) => [value.toLocaleString("en-US"), ""]}
          />
          <Line type="linear" dataKey="v" stroke={colors.line} strokeWidth={1.6} dot={false} isAnimationActive={false} activeDot={{ r: 3, fill: colors.dot }} />
          {lastValue !== undefined && <ReferenceDot x={lastIndex} y={lastValue} r={2.6} fill={colors.dot} stroke="none" isFront ifOverflow="extendDomain" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
