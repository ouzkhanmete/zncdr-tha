// One stacked bar for a full breakdown of one whole into ordered parts -- use-depth buckets,
// token types. One hue, monotone lightness (docs/ui.md: "No colour carries rank... the scale
// reflects category order for reading, never a judgement"). A 2px surface gap separates touching
// segments so neighbours read distinct without a border drawn around them.

export type StackedBarSegment = {
  key: string
  value: number
  colorVar: string // e.g. "var(--scale-1)"
}

export function StackedBar({ segments, height = 22 }: { segments: StackedBarSegment[]; height?: number }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  let cursor = 0

  return (
    <div className="bar-track tall" style={{ height }}>
      {segments.map((s) => {
        const widthPct = total > 0 ? (s.value / total) * 100 : 0
        const leftPct = cursor
        cursor += widthPct
        return (
          <div
            key={s.key}
            className="bar-fill"
            style={{
              left: `${leftPct}%`,
              width: `calc(${widthPct}% - 2px)`,
              background: s.colorVar,
            }}
            title={`${s.key}: ${s.value.toLocaleString("en-US")}`}
          />
        )
      })}
    </div>
  )
}

export type LegendItem = { emoji?: string; swatch?: string; label: string }

export function BarLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((item, i) => (
        <span className="lk" key={i}>
          {item.swatch && <i className="sw" style={{ background: item.swatch }} />}
          {item.emoji && <span>{item.emoji}</span>}
          {item.label}
        </span>
      ))}
    </div>
  )
}
