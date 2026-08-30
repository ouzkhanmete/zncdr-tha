import type { DepthOfUseBucket } from "@app/shared"

// Engineer page, "right now": this person's own use-depth bucket over the last 8 weeks -- never
// a teammate's bucket, per docs/product-brief.md's "no leaderboards" rule. A step line, since a
// bucket is a category, not a number that interpolates smoothly between weeks.

const BUCKET_ORDER: DepthOfUseBucket[] = ["deep", "regular", "light", "dormant"]
const BUCKET_EMOJI: Record<DepthOfUseBucket, string> = { deep: "🚀", regular: "🔧", light: "🌱", dormant: "💤" }

const WIDTH = 460
const HEIGHT = 84
const PAD_LEFT = 30
const PAD_RIGHT = 40
const ROW_Y = [10, 28, 46, 64]

export function UseDepthTimeline({
  previous,
  weeksInPrevious,
  current,
  weeksInCurrent,
}: {
  previous: DepthOfUseBucket
  weeksInPrevious: number
  current: DepthOfUseBucket
  weeksInCurrent: number
}) {
  const totalWeeks = weeksInPrevious + weeksInCurrent
  const rowY = (bucket: DepthOfUseBucket) => ROW_Y[BUCKET_ORDER.indexOf(bucket)]!
  const weekX = (week: number) => PAD_LEFT + (week / (totalWeeks - 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT)

  const dots = Array.from({ length: totalWeeks }, (_, week) => {
    const bucket = week < weeksInPrevious ? previous : current
    return { week, x: weekX(week), y: rowY(bucket) }
  })

  const switchX = weekX(weeksInPrevious - 1)
  const path = `M${dots[0]!.x},${dots[0]!.y} L${switchX},${rowY(previous)} L${switchX},${rowY(current)} L${weekX(totalWeeks - 1)},${rowY(current)}`

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ width: "100%", height: "auto", maxWidth: WIDTH }}
      role="img"
      aria-label={`Use-depth over the last ${totalWeeks} weeks: ${previous} for ${weeksInPrevious} weeks, then ${current} for ${weeksInCurrent} weeks, up to now`}
    >
      {ROW_Y.map((rowYPos, i) => (
        <line key={i} x1={PAD_LEFT} y1={rowYPos} x2={WIDTH - PAD_RIGHT} y2={rowYPos} stroke="var(--border)" />
      ))}
      {BUCKET_ORDER.map((bucket, i) => (
        <text key={bucket} x={PAD_LEFT - 24} y={ROW_Y[i]! + 4} fontSize={12}>
          {BUCKET_EMOJI[bucket]}
        </text>
      ))}

      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      {dots.slice(0, -1).map((d) => (
        <circle key={d.week} cx={d.x} cy={d.y} r={3.5} fill="var(--ink-faint)" />
      ))}
      <circle cx={dots[dots.length - 1]!.x} cy={dots[dots.length - 1]!.y} r={5} fill="var(--accent)" />

      <text x={dots[0]!.x} y={HEIGHT - 4} fontSize={9.5} fill="var(--ink-faint)" textAnchor="middle">
        {totalWeeks}w ago
      </text>
      <text x={dots[dots.length - 1]!.x} y={HEIGHT - 4} fontSize={9.5} fill="var(--ink-faint)" textAnchor="middle">
        now
      </text>
    </svg>
  )
}
