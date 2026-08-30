// Small shapes shared by more than one repository. Nothing here talks to the database itself.

/** A half-open time range: `from` inclusive, `to` exclusive. Every window in docs/metrics.md
 *  is worked out this way, so a run finishing at exactly `to` never lands in two windows. */
export interface DateWindow {
  from: string
  to: string
}

/** The two cross-cutting filters almost every scoped query takes, already resolved to the
 *  numeric ids the database uses -- turning a team id or agent kind string from the wire into
 *  these is a service/controller job, not this one. */
export interface ScopeFilters {
  teamId?: number
  agentKind?: string
}
