import type { ReactNode } from "react"

/**
 * A speed/volume number sharing one card with its quality number, split by a vertical divider --
 * see docs/ui.md: "A shared card makes the pairing visually unbreakable even if someone later
 * reorders the page." This component *is* that guarantee: there is no way to render one side of
 * a pair without the other, because there's only one place to pass them both.
 */
export function PairedCard({
  label,
  left,
  right,
  footnote,
}: {
  label: string
  left: ReactNode
  right: ReactNode
  footnote?: ReactNode
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="pair">
        <div>{left}</div>
        <div>{right}</div>
      </div>
      {footnote && <div className="stat-note" style={{ marginTop: 10 }}>{footnote}</div>}
    </div>
  )
}
