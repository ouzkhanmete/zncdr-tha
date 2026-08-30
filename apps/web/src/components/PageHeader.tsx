import type { ReactNode } from "react"
import { Link } from "react-router-dom"

// The shared top of every screen: a breadcrumb that doubles as real navigation (docs/ui.md says
// so explicitly -- "it's real navigation, not decoration"). It used to carry a second nav strip
// (Org | Team | Engineer | Run) alongside it, but that strip pointed "Engineer" and "Run" at
// fixed sample ids -- dead links once you're looking at anyone else's data -- and duplicated the
// breadcrumb's own job. Removed; the breadcrumb is the only navigation now.

export type Crumb = { label: string; to?: string }

// `active` is kept on the type so the four callers (Org/Team/Engineer/RunPage) that still pass it
// don't need touching -- it no longer does anything now that the nav strip it drove is gone.
export function TopBar({ crumbs }: { crumbs: Crumb[]; active: "org" | "team" | "engineer" | "run" }) {
  return (
    <div className="topbar">
      <div className="crumb">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="sep">/</span>}
            {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

export function PageHead({ title, description, right }: { title: ReactNode; description: string; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {right}
    </div>
  )
}
