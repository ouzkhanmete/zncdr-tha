import { Fragment } from "react"
import { Link, useParams } from "react-router-dom"
import type { RunDetailResponse, RunPolicyFlag } from "@app/shared"
import { getRunDetail } from "../api/runs.ts"
import { BLAME_EMOJI, CAUSE_LABEL } from "../components/FailureGroups.tsx"
import { KIND_LABEL, SEVERITY_EMOJI, STATUS_LABEL } from "../components/FlagsTable.tsx"
import { TopBar } from "../components/PageHeader.tsx"
import { SectionState } from "../components/SectionState.tsx"
import { findEngineer, findTeamName } from "../lib/directory.ts"
import { formatDuration, formatUtcDateTime } from "../lib/format.ts"
import { formatDollarsAndCents } from "../lib/money.ts"
import { useSection } from "../lib/useSection.ts"
import { groupFlagsByTurn, worstSeverity } from "./runFlagPlacement.ts"
import "../styles/run-flags.css"

const STATUS_META: Record<string, { emoji: string; label: string; pill: string }> = {
  succeeded: { emoji: "✅", label: "Succeeded", pill: "pill-good" },
  failed: { emoji: "❌", label: "Failed", pill: "pill-bad" },
  cancelled: { emoji: "⏹️", label: "Cancelled", pill: "pill-neutral" },
  timed_out: { emoji: "⏱️", label: "Timed out", pill: "pill-warn" },
  running: { emoji: "🔄", label: "Running", pill: "pill-neutral" },
}

const ARTIFACT_EMOJI: Record<string, string> = { pull_request: "🔀", commit: "💾", file: "📄", report: "📊" }

// A tool call's own outcome, kept apart from a run's overall status: `RunToolCall.outcome`
// (packages/shared) has no "rule flag" of its own -- `RunPolicyFlag` on the wire carries no
// turnId or toolCallId to tie a flag back to the specific call that raised it, so a flag can only
// be shown at the run level (see the "Rules, this run" card above), not on an individual line
// here. A failed-then-retried tool call is ordinary, not an alarm (docs/ui.md reserves red for
// what someone must act on now), so "failed" gets the same muted ink treatment as everything else
// -- only a timeout gets the amber "worth watching" treatment, matching the run-level timed_out
// status elsewhere on this page.
const TOOL_OUTCOME_META: Record<string, { dot: string; label: string }> = {
  success: { dot: "ok", label: "ok" },
  timeout: { dot: "timeout", label: "timed out" },
  error: { dot: "failed", label: "failed" },
}

function turnDurationMs(startedAt: string, finishedAt: string): number {
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime()
}

/** A short note on a failed attempt's transition arrow -- "why did this get retried". Built from
 *  `TaskAttempt.failureCause`/`.blame` (packages/shared), both real fields on the wire now. */
function transitionNote(attempt: RunDetailResponse["taskAttempts"][number]): string {
  if (!attempt.failureCause) return "retried"
  return `${BLAME_EMOJI[attempt.blame ?? "task"]} ${CAUSE_LABEL[attempt.failureCause]}`
}

/** The anchor id a turn's row carries, so the run-level "Rules" card can link straight to the
 *  turn a flag was also placed on -- one flag, findable in two places, never reading as two. */
function turnAnchorId(turnIndex: number): string {
  return `turn-${turnIndex + 1}`
}

/** A rule flag's own class of severity CSS, keyed the same way `run-flags.css` does. */
function severityClass(severity: RunPolicyFlag["severity"]): string {
  return `severity-${severity}`
}

type RunPageData = {
  run: RunDetailResponse
  teamName: string | null
  engineerName: string | null
}

export function RunPage() {
  const { runId } = useParams()

  const page = useSection<RunPageData>(async () => {
    const run = await getRunDetail(runId!)
    const [teamName, engineer] = await Promise.all([
      findTeamName(run.teamId),
      run.engineerId ? findEngineer(run.engineerId) : Promise.resolve(null),
    ])
    return { run, teamName, engineerName: engineer?.name ?? null }
  }, [runId])

  return (
    <SectionState state={page.status} errorMessage={page.status === "error" ? page.message : undefined} onRetry={page.retry}>
      {page.status === "ready" && <RunPageContent data={page.data} />}
    </SectionState>
  )
}

function RunPageContent({ data }: { data: RunPageData }) {
  const { run, teamName, engineerName } = data
  const statusMeta = STATUS_META[run.status]!
  const stillRunning = run.status === "running"

  const turnsCostCents = run.turns.reduce((s, t) => s + t.costCents, 0)
  // `RunToolCall` (packages/shared) carries no per-call cost -- only turns do. What tool calls
  // cost, in total, is what's left over once every turn's own cost is subtracted from the run's
  // total (docs/testing.md: "the total is the turn costs plus the tool call costs").
  const toolCallsCostCents = Math.max(0, run.totalCostCents - turnsCostCents)
  const chainTotal = run.taskAttempts.reduce((s, a) => s + a.totalCostCents, 0)

  const tokensTotal = run.turns.reduce(
    (acc, t) => ({
      fresh: acc.fresh + t.freshInputTokens,
      cacheWrite: acc.cacheWrite + t.cacheWriteTokens,
      cacheRead: acc.cacheRead + t.cacheReadTokens,
      output: acc.output + t.outputTokens,
      thinking: acc.thinking + t.thinkingTokens,
    }),
    { fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 },
  )

  const toolCallsByTurn = new Map<string, typeof run.toolCalls>()
  for (const call of run.toolCalls) {
    const list = toolCallsByTurn.get(call.turnId) ?? []
    list.push(call)
    toolCallsByTurn.set(call.turnId, list)
  }

  // Which flags belong on which turn -- docs/api.md's RunPolicyFlag.turnId callout. A flag with
  // no turnId never appears here; it stays in the run-level card below only.
  const flagsByTurn = groupFlagsByTurn(run.policyFlags)
  const turnIndexById = new Map(run.turns.map((t) => [t.id, t.index]))

  return (
    <>
      <TopBar
        crumbs={[
          { label: "Org", to: "/" },
          ...(teamName ? [{ label: `Team: ${teamName}`, to: `/teams/${run.teamId}` }] : []),
          ...(run.engineerId && engineerName ? [{ label: engineerName, to: `/engineers/${run.engineerId}` }] : []),
          { label: `Run #${run.id}` },
        ]}
        active="run"
      />

      <div className="page-head" style={{ display: "block" }}>
        <div className="head-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              Run #{run.id}
              <span className={`pill ${statusMeta.pill}`} title={statusMeta.label}>
                {statusMeta.emoji} {statusMeta.label}
              </span>
              {run.isQuietFailure && (
                <span className="pill pill-bad" title="Reported success without doing the job">
                  quiet failure
                </span>
              )}
            </h1>
            <p className="task-desc" style={{ fontSize: 15, margin: 0, maxWidth: 640 }}>
              "{run.taskSummary}"
              {run.engineerId && (
                <>
                  {" "}
                  — 👤 {engineerName ? <Link to={`/engineers/${run.engineerId}`}>{engineerName}</Link> : <Link to={`/engineers/${run.engineerId}`}>engineer</Link>}
                </>
              )}{" "}
              {teamName && (
                <>
                  · 👥 <Link to={`/teams/${run.teamId}`}>{teamName}</Link>
                </>
              )}
            </p>
          </div>
          {/* No date picker here on purpose -- a run happened at one fixed moment, so a range
              filter would be meaningless. Same slot as the picker on the other screens, but an
              exact timestamp and a link back to that day instead. See docs/ui.md. */}
          <div className="daterange">
            <span className="dr-fixed">
              <b>{formatUtcDateTime(run.startedAt)}</b>
              {run.finishedAt && <> → {formatUtcDateTime(run.finishedAt).split("· ")[1]}</>}
            </span>
            <span className="dr-sep" />
            <Link to={`/teams/${run.teamId}`} style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
              see this day on the team page →
            </Link>
          </div>
        </div>
        <div className="meta-row" style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 12.5, color: "var(--ink-soft)" }}>
          <span>
            ⏱️ <b style={{ color: "var(--ink)" }}>{run.durationMs !== null ? formatDuration(run.durationMs) : "in progress"}</b>
          </span>
          <span>
            🤖 <b style={{ color: "var(--ink)" }}>{run.turns[0]?.model ?? run.agentKind}</b>
          </span>
          <span>
            💰 <b style={{ color: "var(--ink)" }}>{formatDollarsAndCents(run.totalCostCents)}</b> total
          </span>
        </div>
      </div>

      {stillRunning && (
        <div className="callout neutral">This run hasn't finished — cost and duration will appear once it ends.</div>
      )}

      {/* CHAIN */}
      <div className="section">
        <div className="section-title">
          This task, start to finish<span className="rule" />
          <span className="hint">
            {run.taskAttempts.length} attempt{run.taskAttempts.length === 1 ? "" : "s"}, 1 task
          </span>
        </div>
        <div className="card">
          <div style={{ display: "flex", alignItems: "stretch", gap: 0, flexWrap: "wrap" }}>
            {run.taskAttempts.map((attempt, i) => {
              const meta = STATUS_META[attempt.status]!
              return (
                <div key={attempt.runId} style={{ display: "flex", alignItems: "center", flex: attempt.isSelf ? 2 : 1, minWidth: 140 }}>
                  {i > 0 && (
                    <div style={{ textAlign: "center", flex: 1, fontSize: 10.5, color: "var(--ink-faint)", padding: "0 6px" }}>
                      {/* Names why the *previous* attempt failed, prompting this retry -- not
                          this attempt's own outcome. */}
                      {transitionNote(run.taskAttempts[i - 1]!)} →
                    </div>
                  )}
                  <div
                    style={{
                      flex: 1,
                      border: `1.5px solid ${attempt.status === "succeeded" ? "var(--good)" : attempt.status === "failed" ? "var(--bad)" : "var(--border-strong)"}`,
                      background: attempt.status === "succeeded" ? "var(--good-soft)" : attempt.status === "failed" ? "var(--bad-soft)" : "var(--surface-2)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700 }}>
                      Attempt {attempt.attemptNumber}
                      {attempt.isSelf ? " — this run" : ""}
                    </div>
                    <div style={{ fontSize: attempt.isSelf ? 15 : 13, marginTop: 4 }}>{meta.emoji}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>{formatDollarsAndCents(attempt.totalCostCents)}</div>
                  </div>
                </div>
              )
            })}
          </div>
          {run.taskAttempts.length > 1 && (
            <div className="stat-note">
              Cost per finished task counts every attempt, not just the one that worked:{" "}
              {run.taskAttempts.map((a, i) => (
                <span key={a.runId}>
                  {i > 0 && " + "}
                  {formatDollarsAndCents(a.totalCostCents)}
                </span>
              ))}{" "}
              = <b>{formatDollarsAndCents(chainTotal)}</b> total for this task.
            </div>
          )}
        </div>
      </div>

      {/* WHAT CAME OUT + RULES */}
      <div className="grid g2">
        <div className="card">
          <div className="card-label">What came out</div>
          {run.artifacts.length === 0 ? (
            <div className="stat-note">Nothing came out of this run.</div>
          ) : (
            run.artifacts.map((a) => (
              <div key={a.id}>
                <div className="stat sm">
                  {ARTIFACT_EMOJI[a.kind]} {a.url ? a.url.split("/").pop() : a.kind}
                </div>
                {a.kind === "pull_request" && (
                  <div className="stat-note">
                    {a.merged ? <span className="pill pill-good" style={{ padding: "1px 8px" }}>merged</span> : <span className="pill pill-neutral" style={{ padding: "1px 8px" }}>open</span>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="card">
          <div className="card-label">🚩 Rules, this run</div>
          {run.policyFlags.length === 0 ? (
            <div className="stat-note">Nothing flagged on this run.</div>
          ) : (
            // Every flag raised in this run, turn-tied or not -- a flag with a turnId is *also*
            // shown on its turn below, and the "on turn N" link here is what ties the two
            // together as one flag, not two (docs/api.md's RunPolicyFlag.turnId callout).
            run.policyFlags.map((f) => {
              const turnIndex = f.turnId !== null ? turnIndexById.get(f.turnId) : undefined
              return (
                <div className="flag-row" key={f.id}>
                  <span className="pill pill-neutral" title={`${f.severity} severity`}>
                    {SEVERITY_EMOJI[f.severity]}
                  </span>
                  <div className="fdesc">
                    <b>{KIND_LABEL[f.kind]}</b>
                    <div className="fmeta">
                      {f.detail && <>{f.detail} · </>}
                      {STATUS_LABEL[f.status]}
                      {turnIndex !== undefined && (
                        <>
                          {" · "}
                          <a href={`#${turnAnchorId(turnIndex)}`}>on turn {turnIndex + 1} ↓</a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* COST BREAKDOWN */}
      <div className="section">
        <div className="section-title">
          💰 Breakdown, this run<span className="rule" />
        </div>
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="num">Tokens</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Fresh input tokens</td>
                  <td className="num">{tokensTotal.fresh.toLocaleString("en-US")}</td>
                  <td className="num">—</td>
                </tr>
                <tr>
                  <td>Cache write tokens</td>
                  <td className="num">{tokensTotal.cacheWrite.toLocaleString("en-US")}</td>
                  <td className="num">—</td>
                </tr>
                <tr>
                  <td>Cache read tokens</td>
                  <td className="num">{tokensTotal.cacheRead.toLocaleString("en-US")}</td>
                  <td className="num">—</td>
                </tr>
                <tr>
                  <td>Output tokens</td>
                  <td className="num">{tokensTotal.output.toLocaleString("en-US")}</td>
                  <td className="num">—</td>
                </tr>
                <tr>
                  <td>Thinking tokens</td>
                  <td className="num">{tokensTotal.thinking.toLocaleString("en-US")}</td>
                  <td className="num">—</td>
                </tr>
                <tr>
                  <td>All turns ({run.turns.length}) — every token type above, priced</td>
                  <td className="num">—</td>
                  <td className="num">{formatDollarsAndCents(turnsCostCents)}</td>
                </tr>
                <tr>
                  <td>Tool calls ({run.toolCalls.length}) — billed by the tool, in cents</td>
                  <td className="num">—</td>
                  <td className="num">{formatDollarsAndCents(toolCallsCostCents)}</td>
                </tr>
                <tr className="total" style={{ borderTop: "2px solid var(--border-strong)", fontWeight: 700 }}>
                  <td>Total</td>
                  <td />
                  <td className="num">{formatDollarsAndCents(turnsCostCents + toolCallsCostCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="stat-note">
            Thinking tokens are billed at the output rate and can drive most of a run's cost — its own row, not hidden
            inside "output." Per-token-type prices aren't shown here: docs/api.md keeps the price table private ("nothing
            exposes the <code>models</code> table directly"), so a turn's cost is priced server-side and returned as one
            total per turn, not itemised by token type on the wire. Tool calls store no per-call cost either — only their
            combined total, recovered here as the run's total minus every turn's own cost.
          </div>
        </div>
      </div>

      {/* TURN BY TURN */}
      <div className="section">
        <div className="section-title">
          Turn by turn<span className="rule" />
          <span className="hint">{run.turns.length} turns</span>
        </div>
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>What happened</th>
                  <th>Model</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Think</th>
                  <th className="num">Time</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {run.turns.map((turn) => {
                  const calls = toolCallsByTurn.get(turn.id) ?? []
                  const turnFlags = flagsByTurn.get(turn.id) ?? []
                  const worst = worstSeverity(turnFlags)
                  return (
                    <Fragment key={turn.id}>
                      <tr id={turnAnchorId(turn.index)} className={worst ? `turn-flagged-${worst}` : undefined}>
                        <td className="num">{turn.index + 1}</td>
                        <td>
                          Turn {turn.index + 1}
                          {/* 🚩 replaces the word "flagged"; the severity mark next to it repeats
                              docs/ui.md's 🔴/🟠/⚪ vocabulary so this never relies on the row's
                              colour alone (that colour also has to survive dark mode and colour
                              vision deficiency -- see docs/ui.md's "Dark mode" section). */}
                          {worst && (
                            <span className="turn-flag-mark" title={`${turnFlags.length} rule flag${turnFlags.length > 1 ? "s" : ""} on this turn`}>
                              🚩 {SEVERITY_EMOJI[worst]}
                            </span>
                          )}
                        </td>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-soft)" }}>{turn.model}</td>
                        <td className="num">{turn.freshInputTokens.toLocaleString("en-US")}</td>
                        <td className="num">{turn.outputTokens.toLocaleString("en-US")}</td>
                        <td className="num">{turn.thinkingTokens > 0 ? turn.thinkingTokens.toLocaleString("en-US") : "—"}</td>
                        <td className="num">{formatDuration(turnDurationMs(turn.startedAt, turn.finishedAt))}</td>
                        <td className="num">{formatDollarsAndCents(turn.costCents, 3)}</td>
                      </tr>
                      {calls.length > 0 && (
                        <tr className="tool-row">
                          <td colSpan={8} style={{ padding: "6px 10px 10px 34px", background: "var(--surface-2)" }}>
                            <div className="tool-calls">
                              {calls.map((c) => {
                                const meta = TOOL_OUTCOME_META[c.outcome]!
                                return (
                                  <div className="tool-call" key={c.id}>
                                    <span className="tc-outcome">
                                      <span className={`tc-dot ${meta.dot}`} aria-hidden="true" />
                                      {meta.label}
                                    </span>
                                    <span className="tc-name">{c.name}</span>
                                    <span className="tc-target" title={c.summary}>
                                      {c.summary}
                                    </span>
                                    <span className="tc-duration">{formatDuration(c.durationMs)}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Placed after this turn's tool calls on purpose -- a reader sees what the
                          agent tried first, then which of those acts tripped the rule. Says what
                          was tried and what happened to it in plain words, so this line stands on
                          its own without opening anything else. */}
                      {turnFlags.length > 0 && (
                        <tr className="tool-row">
                          <td colSpan={8} style={{ padding: "0 10px 10px 34px", background: "var(--surface-2)" }}>
                            <div className="turn-flag-lines">
                              {turnFlags.map((f) => (
                                <div className={`turn-flag-line ${severityClass(f.severity)}`} key={f.id}>
                                  <span aria-hidden="true">{SEVERITY_EMOJI[f.severity]}</span>
                                  <span className="tfl-kind">{KIND_LABEL[f.kind]}</span>
                                  {f.detail && <span className="tfl-detail">{f.detail}</span>}
                                  <span className="tfl-status">{STATUS_LABEL[f.status]}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
