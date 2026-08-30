import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { TeamComparisonPoint } from "@app/shared"
import { Bar, BarChart, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useThemeColors } from "../charts/theme.ts"
import { bandDirection, buildTeamComparisonTooltip, type ComparisonDirection } from "./teamComparisonBar.ts"
import { formatPercent } from "../lib/format.ts"

// "Teams, compared fairly" -- one horizontal bar per team, sorted by success rate, with that
// team's run count labelled on the row and its expected range (the spread luck alone would
// produce, given its run count) drawn as a bracket on the bar. A small team's swing is noise, a
// big team's isn't -- putting the run count and the range right on the bar makes that legible at
// a glance, which a cloud of dots asked the reader to work out for themselves. See docs/ui.md's
// chart-type table and docs/metrics.md's "Comparing teams of different sizes."
//
// This replaced a scatter (rate vs. run count) that also had a real bug: it plotted the shaded
// band as a dense 41-point curve and the teams as an 8-point Scatter sharing one ComposedChart,
// and Recharts' hover tooltip resolves its `payload` by a shared index into whichever series it
// lands on first -- for two series of very different lengths, that is not reliably the series
// under the cursor. The visible symptom was exactly this: hovering a team could show the band
// curve's own row instead (no `rate` field -> "NaN%"; an interpolated `runCount` -> "32.994
// runs"), while the always-correct on-point text label (drawn separately, straight from that
// point's own data) showed the right number a few pixels away. A bar chart's tooltip reads off
// the one row under the cursor -- there is no second, differently-shaped series for it to land on
// instead, so this class of bug can't recur here. `teamComparisonBar.ts`'s
// `buildTeamComparisonTooltip` still guards against a malformed row and renders nothing rather
// than "NaN%", as a backstop rather than a fix for a bug that can still happen here.
//
// Every bar's `rate`/`runCount`/`band`/`withinBand` come straight from `GET /api/teams/comparison`
// (packages/shared's `TeamComparisonPoint`) -- the server is the one place this arithmetic is
// defined (docs/api.md section 11), so a bar is only ever flagged using its own server-computed
// `withinBand`, never recomputed here. `bandDirection` only picks which *side* of that same
// server-provided band a row sits on, for colour and wording -- not a second threshold.
//
// A team outside its range is called out either way, but not in the same colour: below the range
// is red (act-now, docs/ui.md), above it is ink (notable, not alarming) -- red firing for a team
// that is doing *better* than expected would make red mean "unusual" instead of "act now," and it
// would stop meaning anything else on the rest of the product.
//
// The x-axis runs the full 0-100%, not zoomed to the data's own range: a bar's LENGTH is the
// thing a reader compares, and starting it anywhere but zero would exaggerate small, meaningless
// gaps between teams into something that looks like a real difference -- the exact distortion
// docs/metrics.md is warning against. The expected-range bracket is what actually carries "is
// this difference real," drawn at the scale that matters rather than the scale that fills the
// chart.

const ROW_HEIGHT = 34
const AXIS_HEIGHT = 30
const NAME_WIDTH = 92

// The on-bar label sits in its own fixed-width column past the plot's right edge (100%), not
// wherever a given row's own bar or bracket happens to end -- a per-row position that dodges
// whatever's under it is exactly what put the label on top of the error bracket's whisker before
// (a bracket is centred on the org rate, not this row's own rate, so it usually reaches past an
// in-band bar's own tip). A fixed column can never collide with anything inside the plot, because
// nothing in the plot is ever drawn past the 100% mark.
const LABEL_GUTTER = 12
const LABEL_COLUMN_WIDTH = 104

// Below this container width there's nowhere for that label column to sit without crowding the
// plot -- see docs/ui.md: "Anything with labels drawn onto the plot needs a width below which it
// drops them." The bars, colour, sort order, click-through, and axis all stay either way; only
// the on-plot text falls back to the hover tooltip.
const LABEL_MIN_WIDTH = 400

type ThemeColors = ReturnType<
  typeof useThemeColors<Record<"surface" | "border" | "ink" | "inkSoft" | "inkFaint" | "borderStrong" | "bad" | "accentBorder", string>>
>

type Row = TeamComparisonPoint & { errorRange: [number, number] }

function directionColor(colors: ThemeColors, direction: ComparisonDirection): string {
  if (direction === "below") return colors.bad
  if (direction === "above") return colors.ink
  return colors.inkSoft
}

function renderTooltip(colors: ThemeColors) {
  return ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null
    const row = payload[0].payload as Row
    const lines = buildTeamComparisonTooltip(row)
    if (!lines) return null
    const direction = bandDirection(row)
    return (
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 12, padding: "6px 10px" }}>
        <div style={{ color: colors.ink, fontWeight: 600 }}>{lines.teamName}</div>
        <div style={{ color: colors.inkSoft }}>{lines.summary}</div>
        <div style={{ color: colors.inkFaint }}>{lines.expected}</div>
        {lines.callout && <div style={{ color: directionColor(colors, direction), fontWeight: 600 }}>{lines.callout}</div>}
      </div>
    )
  }
}

// A hand-drawn rectangle rather than `<Bar shape="...">`'s defaults, so the fill colour, the
// square-baseline/rounded-tip mark spec, the flagged-row outline, and the optional on-bar label
// can all read straight off this one row's own data (Recharts hands a bar's `shape` function the
// full source row via `props.payload`, unfiltered -- unlike `<LabelList>`'s `content`, which only
// gets the subset of props that survive being spread onto a plain SVG element).
function renderBar(colors: ThemeColors, showLabels: boolean, onSelect: (teamId: string) => void) {
  return (props: any) => {
    const p = props.payload as Row
    const { x, y, width, height } = props
    const w = Math.max(width, 0)
    const r = Math.min(3, height / 2, w)
    const direction = bandDirection(p)
    const color = directionColor(colors, direction)
    // Square at the baseline (x = 0%), rounded only at the data end -- marks-and-anatomy's bar
    // spec -- which a plain `rx`/`ry` rect can't do on just two corners.
    const path =
      w <= 0
        ? `M ${x} ${y} h 0 v ${height} h 0 z`
        : `M ${x} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + height - r} Q ${x + w} ${y + height} ${x + w - r} ${y + height} H ${x} Z`
    // `x` is always the pixel position of value 0 (the shared baseline every bar grows from) and
    // `width` is that row's own `rate` scaled to pixels, so `x + width/rate` reconstructs the
    // pixel position of value 1 (100%) -- the plot's fixed right edge -- without needing the axis
    // scale function. It comes out the same for every row; recomputing it per row (rather than
    // threading it down as a prop) keeps this function reading only from its own row, same as
    // everything else here.
    const plotRightEdgeX = x + (p.rate > 0 ? width / p.rate : 0)
    const labelRightX = plotRightEdgeX + LABEL_GUTTER + LABEL_COLUMN_WIDTH
    return (
      <g
        style={{ cursor: "pointer" }}
        onClick={() => onSelect(p.teamId)}
        role="link"
        aria-label={`${p.teamName}: ${formatPercent(p.rate)} success over ${p.runCount} runs${direction === "in" ? "" : ` -- ${direction} the expected range`}`}
      >
        <path d={path} fill={color} stroke={direction === "in" ? "none" : color} strokeWidth={direction === "in" ? 0 : 1.5} strokeOpacity={0.5} />
        {showLabels && (
          <text x={labelRightX} y={y + height / 2} dy={4} textAnchor="end" fontSize={11} fontWeight={direction === "in" ? 400 : 700} fill={color}>
            {formatPercent(p.rate)} · {p.runCount} runs
          </text>
        )}
      </g>
    )
  }
}

export function TeamComparisonScatter({ points, orgRate }: { points: TeamComparisonPoint[]; orgRate: number }) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const colors = useThemeColors({
    surface: "var(--surface)",
    border: "var(--border)",
    ink: "var(--ink)",
    inkSoft: "var(--ink-soft)",
    inkFaint: "var(--ink-faint)",
    borderStrong: "var(--border-strong)",
    bad: "var(--bad)",
    accentBorder: "var(--accent-border)",
  })

  const rows: Row[] = [...points]
    .sort((a, b) => b.rate - a.rate)
    .map((p) => ({ ...p, errorRange: [p.rate - p.band.low, p.band.high - p.rate] }))

  const showLabels = width >= LABEL_MIN_WIDTH
  const height = rows.length * ROW_HEIGHT + AXIS_HEIGHT
  const below = rows.filter((r) => bandDirection(r) === "below").map((r) => r.teamName)
  const above = rows.filter((r) => bandDirection(r) === "above").map((r) => r.teamName)

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Each team's success rate against its run count, sorted high to low, with the range expected from luck alone shown on each bar. ${
        below.length ? `Below that range: ${below.join(", ")}. ` : ""
      }${above.length ? `Above that range: ${above.join(", ")}.` : ""}${below.length || above.length ? "" : "No team is outside its expected range."}`}
      style={{ width: "100%", height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 16, right: showLabels ? LABEL_GUTTER + LABEL_COLUMN_WIDTH + 8 : 16, bottom: 4, left: 4 }}>
          <XAxis
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            tickFormatter={(v: number) => formatPercent(v)}
            tick={{ fill: colors.inkFaint, fontSize: 10.5 }}
            axisLine={{ stroke: colors.borderStrong }}
            tickLine={false}
          />
          <YAxis type="category" dataKey="teamName" width={NAME_WIDTH} tick={{ fill: colors.ink, fontSize: 11.5 }} axisLine={false} tickLine={false} />
          <Tooltip content={renderTooltip(colors)} cursor={{ fill: colors.border, opacity: 0.3 }} />
          <ReferenceLine
            x={orgRate}
            stroke={colors.borderStrong}
            strokeDasharray="3 3"
            label={{ value: `org avg ${formatPercent(orgRate)}`, position: "top", fill: colors.inkFaint, fontSize: 10.5 }}
          />
          <Bar dataKey="rate" shape={renderBar(colors, showLabels, (teamId) => navigate(`/teams/${teamId}`))} maxBarSize={20} isAnimationActive={false}>
            <ErrorBar dataKey="errorRange" direction="x" width={5} strokeWidth={2} stroke={colors.accentBorder} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
