/**
 * Builds the `routes` object `Bun.serve` needs -- one entry per endpoint in docs/api.md, every
 * handler wrapped so an unexpected error becomes a plain 500 instead of taking the server down.
 *
 * `index.ts` is the only file that knows how a repository, a service, and a controller fit
 * together (docs/architecture.md); this file only knows how a path maps to an already-built
 * controller. `GET /api/teams/comparison` and `GET /api/teams/:teamId/comparison` share a
 * prefix -- Bun's router matches an exact path ahead of a `:param` one on its own (see
 * docs/api.md's own routing note), so no ordering trick is needed here beyond listing both.
 */

import type { Database } from "bun:sqlite"
import { SqliteArtifactRepository } from "../repositories/artifacts.ts"
import { SqliteBudgetRepository } from "../repositories/budgets.ts"
import type { EngineerRepository } from "../repositories/engineers.ts"
import { SqliteEngineerRepository } from "../repositories/engineers.ts"
import { SqliteModelRepository } from "../repositories/models.ts"
import { SqliteOrgRepository } from "../repositories/orgs.ts"
import { SqlitePolicyFlagRepository } from "../repositories/policy-flags.ts"
import { SqliteRunRepository } from "../repositories/runs.ts"
import type { TeamRepository } from "../repositories/teams.ts"
import { SqliteTeamRepository } from "../repositories/teams.ts"
import { SqliteToolCallRepository } from "../repositories/tool-calls.ts"
import { SqliteTurnRepository } from "../repositories/turns.ts"
import { AdoptionService } from "../services/adoption.ts"
import { BudgetWriteService } from "../services/budget-write.ts"
import { BudgetService } from "../services/budget.ts"
import { ComparisonService } from "../services/comparison.ts"
import { CostService } from "../services/cost.ts"
import { EngineerService } from "../services/engineer.ts"
import { LookupService } from "../services/lookup.ts"
import { OutcomeService } from "../services/outcome.ts"
import { ReliabilityService } from "../services/reliability.ts"
import { RulesService } from "../services/rules.ts"
import { RunQueryService } from "../services/run-query.ts"
import { SpeedService } from "../services/speed.ts"
import { SummaryService } from "../services/summary.ts"
import { TrendService } from "../services/trend.ts"
import { getBudgetStatus, getTeamBudget, putTeamBudget } from "./controllers/budgets.ts"
import { getTeamComparison, getTeamsComparison } from "./controllers/comparison.ts"
import { getEngineerOverview, getEngineerRuns, getEngineerTrend } from "./controllers/engineers.ts"
import { listFlags } from "./controllers/flags.ts"
import { getFilterOptions, listTeams } from "./controllers/lookup.ts"
import {
  getAdoption,
  getCost,
  getFlagsSummary,
  getInProgress,
  getOutcomes,
  getReliability,
  getSpeed,
  getSummary,
} from "./controllers/metrics.ts"
import { getRunDetail, searchRuns } from "./controllers/runs.ts"
import { getTrend } from "./controllers/trend.ts"
import { withErrorHandling } from "./respond.ts"

export interface AppServices {
  orgId: number
  teams: TeamRepository
  engineers: EngineerRepository
  lookup: LookupService
  summary: SummaryService
  adoption: AdoptionService
  outcome: OutcomeService
  cost: CostService
  reliability: ReliabilityService
  speed: SpeedService
  rules: RulesService
  trend: TrendService
  comparison: ComparisonService
  budget: BudgetService
  budgetWrite: BudgetWriteService
  engineerService: EngineerService
  runQuery: RunQueryService
}

/**
 * Opens no connection of its own -- `db` is already open, migrated, and ready. Builds one
 * repository per table, then one service per group on top of the repositories it needs, exactly
 * the shape docs/architecture.md's own worked example draws (`new RunRepository(db)` ->
 * `new MetricsService(runRepo, teamRepo)` -> `new MetricsController(metrics)`). Shared by
 * `index.ts` (the real server) and `apps/api/test`'s end-to-end tests (a real temporary
 * database), so both run the exact same wiring.
 */
export function buildServices(db: Database, orgId: number): AppServices {
  const teamRepo = new SqliteTeamRepository(db)
  const engineerRepo = new SqliteEngineerRepository(db)
  const modelRepo = new SqliteModelRepository(db)
  const runRepo = new SqliteRunRepository(db)
  const turnRepo = new SqliteTurnRepository(db)
  const toolCallRepo = new SqliteToolCallRepository(db)
  const artifactRepo = new SqliteArtifactRepository(db)
  const policyFlagRepo = new SqlitePolicyFlagRepository(db)
  const budgetRepo = new SqliteBudgetRepository(db)
  const orgRepo = new SqliteOrgRepository(db)

  const costService = new CostService(runRepo, turnRepo)

  return {
    orgId,
    teams: teamRepo,
    engineers: engineerRepo,
    lookup: new LookupService(teamRepo, engineerRepo, runRepo),
    summary: new SummaryService(runRepo, costService),
    adoption: new AdoptionService(orgRepo, engineerRepo, runRepo),
    outcome: new OutcomeService(runRepo, artifactRepo),
    cost: costService,
    reliability: new ReliabilityService(runRepo),
    speed: new SpeedService(runRepo, turnRepo),
    rules: new RulesService(policyFlagRepo),
    trend: new TrendService(runRepo),
    comparison: new ComparisonService(runRepo, teamRepo),
    budget: new BudgetService(budgetRepo, runRepo, teamRepo),
    budgetWrite: new BudgetWriteService(budgetRepo),
    engineerService: new EngineerService(runRepo, artifactRepo, costService),
    runQuery: new RunQueryService(runRepo, artifactRepo, turnRepo, toolCallRepo, policyFlagRepo, modelRepo),
  }
}

export function buildRoutes(s: AppServices) {
  const { orgId } = s
  return {
    "/api/filter-options": withErrorHandling(getFilterOptions(s.lookup, s.teams, orgId)),
    "/api/teams": withErrorHandling(listTeams(s.lookup, orgId)),

    "/api/metrics/summary": withErrorHandling(getSummary(s.summary, s.teams, orgId)),
    "/api/metrics/adoption": withErrorHandling(getAdoption(s.adoption, s.teams, orgId)),
    "/api/metrics/outcomes": withErrorHandling(getOutcomes(s.outcome, s.teams, orgId)),
    "/api/metrics/cost": withErrorHandling(getCost(s.cost, s.teams, orgId)),
    "/api/metrics/reliability": withErrorHandling(getReliability(s.reliability, s.teams, orgId)),
    "/api/metrics/speed": withErrorHandling(getSpeed(s.speed, s.teams, orgId)),
    "/api/metrics/flags": withErrorHandling(getFlagsSummary(s.rules, s.teams, orgId)),
    "/api/metrics/in-progress": withErrorHandling(getInProgress(s.outcome, s.teams, orgId)),

    "/api/flags": withErrorHandling(listFlags(s.rules, s.teams, orgId)),

    "/api/budget-status": withErrorHandling(getBudgetStatus(s.budget, s.teams, orgId)),
    "/api/teams/:teamId/budget": {
      GET: withErrorHandling(getTeamBudget(s.budgetWrite, s.teams, orgId)),
      PUT: withErrorHandling(putTeamBudget(s.budgetWrite, s.teams, orgId)),
    },

    // Exact path first in the object purely for a human reading top to bottom -- Bun's router
    // resolves this correctly regardless of declaration order.
    "/api/teams/comparison": withErrorHandling(getTeamsComparison(s.comparison, orgId)),
    "/api/teams/:teamId/comparison": withErrorHandling(getTeamComparison(s.comparison, s.teams, orgId)),

    "/api/trend": withErrorHandling(getTrend(s.trend, s.teams, orgId)),

    "/api/engineers/:engineerId/overview": withErrorHandling(getEngineerOverview(s.engineerService, s.engineers, orgId)),
    "/api/engineers/:engineerId/trend": withErrorHandling(getEngineerTrend(s.trend, s.engineers, orgId)),
    "/api/engineers/:engineerId/runs": withErrorHandling(getEngineerRuns(s.runQuery, s.engineers, orgId)),

    "/api/runs": withErrorHandling(searchRuns(s.runQuery, s.teams, s.engineers, orgId)),
    "/api/runs/:runId": withErrorHandling(getRunDetail(s.runQuery)),
  } as const
}
