import type { Blame, FailureCause, FailureWindow } from "@app/shared"
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { tooltipProps, useThemeColors } from "../charts/theme.ts"
import { formatPercent } from "../lib/format.ts"

// Failure rate grouped by who can fix it -- whose-problem is the number that matters here, not a
// flat list of causes. See docs/ui.md's chart-type table: "grouping by owner instead of by raw
// cause count is what makes the chart actionable." Emoji doubles as the group's fixed identity
// colour's secondary channel, so org-setup/platform/task never rely on hue alone.
//
// Each group's causes are one small horizontal bar chart -- causes within a group aren't separate
// identities competing for colour, they're all "this group's problem," so every bar in a panel
// shares that group's one fixed colour (--blame-org/platform/task) and rank is read off length and
// the value at each bar's tip, not off a colour scale.

const BLAME_ORDER: Blame[] = ["org_setup", "platform", "task"]

const BLAME_META: Record<Blame, { emoji: string; label: string; className: string; colorVar: string }> = {
  org_setup: { emoji: "🔒", label: "Org setup", className: "fg-org", colorVar: "var(--blame-org)" },
  platform: { emoji: "⚙️", label: "Platform", className: "fg-platform", colorVar: "var(--blame-platform)" },
  task: { emoji: "🧩", label: "Task", className: "fg-task", colorVar: "var(--blame-task)" },
}

export const CAUSE_LABEL: Record<FailureCause, string> = {
  missing_permission: "Missing permission",
  missing_secret_or_login: "Missing secret or login",
  tool_not_available: "Tool not available",
  network_or_sandbox_blocked: "Network / sandbox blocked",
  hit_token_or_time_limit: "Hit token or time limit",
  dependency_install_failed: "Dependency install failed",
  ran_out_of_context: "Ran out of context room",
  infrastructure_crash: "Infrastructure crash",
  rate_limited: "Rate limited",
  model_refused: "Model refused",
  tests_failed: "Tests failed",
  nothing_useful_produced: "Nothing useful produced",
}

export const BLAME_EMOJI: Record<Blame, string> = { org_setup: "🔒", platform: "⚙️", task: "🧩" }

const CAUSE_BLAME: Record<FailureCause, Blame> = {
  missing_permission: "org_setup",
  missing_secret_or_login: "org_setup",
  tool_not_available: "org_setup",
  network_or_sandbox_blocked: "org_setup",
  hit_token_or_time_limit: "org_setup",
  ran_out_of_context: "platform",
  infrastructure_crash: "platform",
  rate_limited: "platform",
  tests_failed: "task",
  nothing_useful_produced: "task",
  dependency_install_failed: "task",
  model_refused: "task",
}

const ROW_HEIGHT = 26

export function FailureGroups({
  window,
  groupNotes,
}: {
  window: FailureWindow
  /** e.g. `{ org_setup: "org avg 6.1%" }` -- the team page's "in line with org" comparisons. */
  groupNotes?: Partial<Record<Blame, string>>
}) {
  const colors = useThemeColors({
    surface: "var(--surface)",
    border: "var(--border)",
    ink: "var(--ink)",
    inkSoft: "var(--ink-soft)",
  })

  const causesByBlame: Record<Blame, typeof window.byCause> = { org_setup: [], platform: [], task: [] }
  for (const c of window.byCause) {
    causesByBlame[CAUSE_BLAME[c.cause]].push(c)
  }
  for (const list of Object.values(causesByBlame)) {
    list.sort((a, b) => b.rate - a.rate)
  }

  return (
    <div className="fail-groups">
      {BLAME_ORDER.map((blame) => {
        const meta = BLAME_META[blame]
        const groupTotal = window.byBlame.find((b) => b.blame === blame)
        const note = groupNotes?.[blame]
        const causes = causesByBlame[blame]
        const chartData = causes.map((c) => ({ cause: c.cause, label: CAUSE_LABEL[c.cause], rate: c.rate }))

        return (
          <div className={`fail-group ${meta.className}`} key={blame}>
            <h4>
              {meta.emoji} {meta.label}
            </h4>
            <div className="fg-sub">
              {formatPercent(groupTotal?.rate ?? 0, 1)} of ended runs{note ? ` · ${note}` : ""}
            </div>
            {chartData.length > 0 && (
              <div style={{ height: chartData.length * ROW_HEIGHT }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={6}>
                    <XAxis type="number" hide domain={[0, (max: number) => max * 1.2]} />
                    {/* Wide enough for the longest cause the enum can produce ("Network / sandbox
                        blocked", "Dependency install failed" -- 26 characters) at this font size,
                        with room to spare -- a fixed enum has a knowable worst case, so this is
                        sized for that rather than guessed. Never truncated with an ellipsis: a
                        reader deciding what to fix this afternoon needs the full cause on screen,
                        not one they have to hover to read. */}
                    <YAxis type="category" dataKey="label" width={210} tick={{ fill: colors.inkSoft, fontSize: 10.5 }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipProps(colors)} formatter={(value: number) => [formatPercent(value, 1), "Rate"]} cursor={{ fill: colors.border, opacity: 0.4 }} />
                    <Bar dataKey="rate" fill={meta.colorVar} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                      <LabelList dataKey="rate" position="right" formatter={(v: number) => formatPercent(v, 1)} fill={colors.inkSoft} fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
