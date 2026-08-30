import { formatDollarsAndCents } from "../lib/money.ts"

// Cost per finished task: a horizontal number line with median, average, and worst case marked.
// Costs here are long-tailed -- a runaway run can cost 30x the median -- so three separate boxes
// would hide exactly the spread this chart exists to show. See docs/ui.md's chart-type table.
//
// Position uses a square-root scale of the raw cent values (not a linear one): a linear scale
// crams the median and average together near the left edge whenever the worst case is this much
// bigger, which is the one thing a number line is supposed to prevent.
function scalePosition(valueCents: number, worstCents: number, min = 4, max = 96): number {
  if (worstCents <= 0) return min
  const t = Math.sqrt(Math.max(0, valueCents)) / Math.sqrt(worstCents)
  return min + t * (max - min)
}

// Each label is two lines of text, wide enough that two dots much closer together than this
// (in percent of the track) would overlap. Median and average are often close by definition --
// nudging the average's position apart, rather than the more-different worst case, keeps both
// legible without touching worst's already-clear position.
const MIN_LABEL_GAP_PCT = 15

export function CostNumberLine({
  medianCents,
  averageCents,
  worstCents,
}: {
  medianCents: number
  averageCents: number
  worstCents: number
}) {
  const medianPct = scalePosition(medianCents, worstCents)
  const rawAveragePct = scalePosition(averageCents, worstCents)
  const worstPct = scalePosition(worstCents, worstCents)
  const averagePct = Math.min(rawAveragePct < medianPct + MIN_LABEL_GAP_PCT ? medianPct + MIN_LABEL_GAP_PCT : rawAveragePct, worstPct - MIN_LABEL_GAP_PCT)

  return (
    <div className="range" role="img" aria-label={`Median ${formatDollarsAndCents(medianCents)}, average ${formatDollarsAndCents(averageCents)}, worst case ${formatDollarsAndCents(worstCents)}`}>
      <div className="line" />
      <div className="rlabel" style={{ left: `${medianPct}%` }}>
        <b>{formatDollarsAndCents(medianCents)}</b>Median
      </div>
      <div className="dot median" style={{ left: `${medianPct}%` }} />
      <div className="rlabel" style={{ left: `${averagePct}%` }}>
        <b>{formatDollarsAndCents(averageCents)}</b>Average
      </div>
      <div className="dot avgd" style={{ left: `${averagePct}%` }} />
      <div className="rlabel" style={{ left: `${worstPct}%` }}>
        <b>{formatDollarsAndCents(worstCents)}</b>Worst case
      </div>
      <div className="dot worst" style={{ left: `${worstPct}%` }} />
    </div>
  )
}
