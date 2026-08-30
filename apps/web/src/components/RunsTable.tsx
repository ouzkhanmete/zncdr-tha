import { Link } from "react-router-dom"
import type { RunRow } from "./runRow.ts"

// The recent-runs table shared by the Org and Team pages (Fix 1 in the product feedback -- right
// now a run is only reachable by drilling org -> team -> engineer -> run; this puts one directly
// on the two pages that used to dead-end before it). Same "real table, numbers right-aligned, in
// a scroll container" pattern every other table on these pages already follows, and the same
// "whole row opens the detail page" the Engineer page's own recent-runs table already does.
//
// The link is one real `<a>` stretched across the row with CSS (`.stretched-link`, global.css),
// not a click handler on the `<tr>` -- so a keyboard tab and a screen reader both still see
// exactly one link, per docs/ui.md's accessibility rule for a clickable row.

export function RunsTable({ rows, showTeam = false }: { rows: RunRow[]; showTeam?: boolean }) {
  if (rows.length === 0) {
    return <div className="stat-note">No runs yet.</div>
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Task</th>
            <th>Engineer</th>
            {showTeam && <th>Team</th>}
            <th>Outcome</th>
            <th className="mid">Out</th>
            <th className="num">Cost</th>
            <th className="num">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="rowlink">
              <td className="tabular">{row.whenLabel}</td>
              <td>
                <Link className="stretched-link" to={`/runs/${row.runId}`}>
                  {row.taskSummary}
                </Link>
              </td>
              <td>{row.engineerLabel}</td>
              {showTeam && <td>{row.teamLabel ?? "—"}</td>}
              <td>{row.outcomeEmoji ? `${row.outcomeEmoji} ${row.outcomeLabel}` : row.outcomeLabel}</td>
              <td className="mid" title={row.outputEmoji ? undefined : "Nothing came out of this run"}>
                {row.outputEmoji ?? "—"}
              </td>
              <td className="num">{row.costLabel}</td>
              <td className="num">{row.durationLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
