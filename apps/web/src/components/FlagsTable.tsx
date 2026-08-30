import type { Disposition, FlagListItem, PolicyFlagKind, Severity } from "@app/shared"
import { Link } from "react-router-dom"
import { formatUtcDateTime } from "../lib/format.ts"

// A rule flag, ranked by how new it is for the team that got it -- not by raw count. A steady
// background rate of something already tolerated is exactly the noise this ranking is meant to
// bury under the one thing actually worth a look. See docs/ui.md's chart-type table.

// Exported for the run page's own flag rows (`RunPage.tsx`'s run-level "Rules" card and its
// turn-by-turn placement of the same flags) so the two screens use one literal set of emoji and
// labels between them, not two that could quietly drift apart.
export const SEVERITY_EMOJI: Record<Severity, string> = { high: "🔴", medium: "🟠", low: "⚪" }

export const STATUS_LABEL: Record<Disposition, string> = {
  confirmed: "confirmed",
  expected_and_dismissed: "expected, dismissed",
  under_review: "still being looked at",
}

export const KIND_LABEL: Record<PolicyFlagKind, string> = {
  suspected_prompt_injection: "Suspected prompt injection",
  goal_hijacked: "Goal hijacked",
  unsafe_tool_use: "Tool used in an unsafe way",
  excess_access_requested: "Asked for more access than needed",
  blocked_domain_attempt: "Tried a blocked domain",
  secret_exposed: "Secret showed up somewhere it shouldn't",
  unsafe_command: "Ran an unsafe command",
  attempted_exfiltration: "Tried to send data somewhere it shouldn't",
  spend_cap_crossed: "Spend cap crossed",
}

export function FlagsTable({
  items,
  teamNameFor,
}: {
  items: FlagListItem[]
  /** Present only for the org page's flag table, which shows which team each flag belongs to. */
  teamNameFor?: (item: FlagListItem) => string
}) {
  if (items.length === 0) {
    return <div className="stat-note">No flags in this window.</div>
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th />
            <th>Flag</th>
            <th>Run</th>
            {teamNameFor && <th>Team</th>}
            <th>Status</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {/* The whole row opens the run that tripped this flag -- that's where it's already
              shown in context, next to the turn that caused it. One real link, stretched across
              the row with CSS (`.stretched-link`, global.css), not a click handler on the `<tr>`,
              so it's still one link a keyboard and a screen reader both see correctly. */}
          {items.map((item) => (
            <tr key={item.id} className="rowlink">
              <td style={{ textAlign: "center", fontSize: 14 }}>{SEVERITY_EMOJI[item.severity]}</td>
              <td>
                <Link className="stretched-link" to={`/runs/${item.runId}`}>
                  <b>{KIND_LABEL[item.kind]}</b>
                </Link>
                <div className="stat-note" style={{ marginTop: 2 }}>
                  {item.isNewKindForScope ? "new here" : "seen before"}
                </div>
              </td>
              <td>Run #{item.runId}</td>
              {teamNameFor && <td>{teamNameFor(item)}</td>}
              <td>{STATUS_LABEL[item.status]}</td>
              <td className="tabular">{formatUtcDateTime(item.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
