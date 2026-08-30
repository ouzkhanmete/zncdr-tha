/**
 * Group 5 -- Rules: an agent tried something it should not have. See docs/metrics.md.
 *
 * Flags are ranked by what is new for a team, not by raw count -- a team seeing a kind of flag
 * for the first time belongs above a team with ten more of a kind it always sees. We also track
 * how often a flag is dismissed as expected, because a rule that is wrong most of the time needs
 * retuning, not ignoring.
 */

import { disposition, policyFlagKind, severity } from "@app/shared"
import type { Disposition, PolicyFlagKind, Severity } from "@app/shared"
import type { PolicyFlagRepository, PolicyFlagWithTeam } from "../repositories/policy-flags.ts"
import type { DateWindow, ScopeFilters } from "../repositories/types.ts"

const ALL_SEVERITIES = severity.options
const ALL_DISPOSITIONS = disposition.options
const ALL_KINDS = policyFlagKind.options

/** A rate with nothing to divide by is 0, not NaN. */
function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export interface RulesQuery {
  orgId: number
  from: string
  to: string
  filters?: ScopeFilters
}

export interface SeverityCount {
  severity: Severity
  count: number
}

export interface StatusCount {
  status: Disposition
  count: number
}

export interface DismissedExpectedByKind {
  kind: PolicyFlagKind
  triggered: number
  dismissedAsExpected: number
  rate: number
}

export interface FlagsSummary {
  from: string
  to: string
  bySeverity: SeverityCount[]
  byStatus: StatusCount[]
  /** Dismissed-as-expected share across every flag in the window, all kinds pooled -- the one
   *  headline number. */
  dismissedExpectedRate: number
  /** The same rate, one row per kind -- "a rule that is wrong most of the time needs retuning"
   *  only means something once you know *which* rule. See docs/metrics.md Group 5. */
  dismissedExpectedByKind: DismissedExpectedByKind[]
}

export interface RankedFlag extends PolicyFlagWithTeam {
  /** True the first time this flag's team has ever seen this kind, as of the moment this flag
   *  was raised -- docs/metrics.md Group 5's "new for this team", the thing flags are ranked on.
   *  Always evaluated against the flag's own team, whether or not the query itself is scoped to
   *  one team -- "new" is a fact about a team's history, not about the shape of the request that
   *  happened to surface it. */
  isNewKindForScope: boolean
}

export interface ListFlagsQuery extends RulesQuery {
  limit: number
  offset: number
  severity?: Severity
  status?: Disposition
  kind?: PolicyFlagKind
}

export interface RankedFlagsPage {
  items: RankedFlag[]
  total: number
  limit: number
  offset: number
}

export class RulesService {
  constructor(private readonly flagRepo: PolicyFlagRepository) {}

  getSummary(query: RulesQuery): FlagsSummary {
    const { orgId, from, to, filters } = query
    const window: DateWindow = { from, to }
    const flags = this.flagRepo.listCreatedInWindow(orgId, window, filters)

    const severityCounts = new Map<Severity, number>()
    const statusCounts = new Map<Disposition, number>()
    const byKind = new Map<PolicyFlagKind, { triggered: number; dismissedAsExpected: number }>()
    let totalDismissed = 0

    for (const flag of flags) {
      severityCounts.set(flag.severity, (severityCounts.get(flag.severity) ?? 0) + 1)
      statusCounts.set(flag.disposition, (statusCounts.get(flag.disposition) ?? 0) + 1)

      const kindEntry = byKind.get(flag.kind) ?? { triggered: 0, dismissedAsExpected: 0 }
      kindEntry.triggered++
      if (flag.disposition === "expected_and_dismissed") {
        kindEntry.dismissedAsExpected++
        totalDismissed++
      }
      byKind.set(flag.kind, kindEntry)
    }

    return {
      from,
      to,
      bySeverity: ALL_SEVERITIES.map((s) => ({ severity: s, count: severityCounts.get(s) ?? 0 })),
      byStatus: ALL_DISPOSITIONS.map((d) => ({ status: d, count: statusCounts.get(d) ?? 0 })),
      dismissedExpectedRate: safeRate(totalDismissed, flags.length),
      dismissedExpectedByKind: ALL_KINDS.map((kind) => {
        const entry = byKind.get(kind) ?? { triggered: 0, dismissedAsExpected: 0 }
        return { kind, ...entry, rate: safeRate(entry.dismissedAsExpected, entry.triggered) }
      }),
    }
  }

  listRanked(query: ListFlagsQuery): RankedFlagsPage {
    const { orgId, from, to, filters, limit, offset, severity: severityFilter, status, kind } = query
    const window: DateWindow = { from, to }
    let flags = this.flagRepo.listCreatedInWindowWithTeam(orgId, window, filters)

    if (severityFilter !== undefined) flags = flags.filter((f) => f.severity === severityFilter)
    if (status !== undefined) flags = flags.filter((f) => f.disposition === status)
    if (kind !== undefined) flags = flags.filter((f) => f.kind === kind)

    const ranked: RankedFlag[] = flags.map((flag) => ({
      ...flag,
      isNewKindForScope:
        this.flagRepo.countPriorByKindForTeam(flag.teamId, flag.kind, flag.createdAt) === 0,
    }))

    // New-for-this-team ranks first, regardless of raw volume; recency breaks ties within each
    // group. See docs/metrics.md Group 5 and docs/testing.md's Group 5 ranking test.
    ranked.sort((a, b) => {
      if (a.isNewKindForScope !== b.isNewKindForScope) return a.isNewKindForScope ? -1 : 1
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    const total = ranked.length
    const items = ranked.slice(offset, offset + limit)
    return { items, total, limit, offset }
  }
}
