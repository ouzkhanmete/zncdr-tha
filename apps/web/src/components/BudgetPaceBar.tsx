import { useEffect, useRef, useState } from "react"
import type { BudgetStatusResponse } from "@app/shared"

/**
 * The org table's per-team pace bar: percent used, with the day-of-month, warning, and stop
 * lines overlaid so "ahead of pace" is readable without doing the math. The fill is a plain
 * neutral colour until a line is actually crossed -- amber past the warning line, red past the
 * stop line -- never coloured just because one team's number is lower than another's. See
 * docs/ui.md: red is for act-now, amber is a nudge, and everything else stays plain ink.
 *
 * The warning and stop lines are plain coloured vertical rules -- amber and red -- not an emoji
 * pin. At the size this bar renders (a 220px table column) a glyph is visual mush; colour and
 * position carry the meaning instead. A short word rides along the line wherever the warning and
 * stop lines sit far enough apart not to collide; where they're too close, the line alone still
 * carries the meaning and the native `title` tooltip gives the exact value on hover. See
 * docs/ui.md's emoji section: a glyph stands in for a word in running text, not for a mark inside
 * a chart. The team page reuses this for its own bigger, three-marker treatment; see
 * `BudgetBurnChart`.
 */

// Below this gap (in pixels) between the warning and stop lines, "warn"/"stop" text would
// overlap -- drop both labels rather than let them collide. Two 4-letter words at 9px each need
// roughly 20px of their own width either side of centre, so ~36px of clearance keeps them apart.
const MIN_LABEL_GAP_PX = 36

export function BudgetPaceBar({ status }: { status: BudgetStatusResponse }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setTrackWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const usedPct = status.limitCents > 0 ? (status.spentSoFarCents / status.limitCents) * 100 : 0
  const warnPct = status.limitCents > 0 ? (status.warnCents / status.limitCents) * 100 : 0
  const stopPct = status.limitCents > 0 ? (status.stopCents / status.limitCents) * 100 : 0
  const todayPct = status.monthProgress * 100
  const showLineLabels = trackWidth > 0 && ((stopPct - warnPct) / 100) * trackWidth >= MIN_LABEL_GAP_PX

  return (
    <div
      ref={trackRef}
      className="bar-track"
      role="img"
      aria-label={`${Math.round(usedPct)}% of budget used, warning line at ${Math.round(warnPct)}%, stop line at ${Math.round(stopPct)}%`}
    >
      <div
        className="bar-fill"
        style={{
          width: `${Math.min(100, usedPct)}%`,
          background: status.stopLineCrossed ? "var(--bad)" : status.warnLineCrossed ? "var(--warn)" : "var(--ink-soft)",
        }}
      />
      <div className="bar-mark" style={{ left: `${todayPct}%` }} />
      <div className="bar-mark warn" style={{ left: `${warnPct}%` }} title={`warning line · ${Math.round(warnPct)}% of budget`}>
        {showLineLabels && <span className="bar-line-label warn">warn</span>}
      </div>
      <div className="bar-mark stop" style={{ left: `${stopPct}%` }} title={`stop line · ${Math.round(stopPct)}% of budget`}>
        {showLineLabels && <span className="bar-line-label stop">stop</span>}
      </div>
    </div>
  )
}
