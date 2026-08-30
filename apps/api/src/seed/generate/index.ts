import { Rng } from "../rng.ts"
import { generateBudgets, type GeneratedBudget } from "./budgets.ts"
import { generateFlags, type GeneratedPolicyFlag } from "./flags.ts"
import { generateModels, type GeneratedModel } from "./models.ts"
import { generateOrg, type GeneratedEngineer, type GeneratedOrg, type GeneratedTeam } from "./org.ts"
import {
  generateRuns,
  type GeneratedArtifact,
  type GeneratedRun,
  type GeneratedToolCall,
  type GeneratedTurn,
} from "./runs.ts"

export interface SeedDataset {
  org: GeneratedOrg
  teams: GeneratedTeam[]
  engineers: GeneratedEngineer[]
  models: GeneratedModel[]
  runs: GeneratedRun[]
  turns: GeneratedTurn[]
  toolCalls: GeneratedToolCall[]
  artifacts: GeneratedArtifact[]
  policyFlags: GeneratedPolicyFlag[]
  budgets: GeneratedBudget[]
}

/**
 * Builds the whole 180-day dataset in memory, from one fixed seed. Nothing here touches a
 * database -- see insert.ts for that -- so this same function is what both `bun run seed` and
 * seed.test.ts call to get an identical, reproducible set of rows.
 */
export function generateSeedData(seed: number): SeedDataset {
  const rng = new Rng(seed)

  const orgData = generateOrg(rng)
  const models = generateModels()
  const { runs, turns, toolCalls, artifacts } = generateRuns(rng, orgData, models)
  const policyFlags = generateFlags(rng, runs, turns, orgData.teams)
  // Budget calibration runs last: it nudges Nova and Atlas's current-month turn costs to match
  // the dollar figures docs/seed-data.md names, so it has to see the final run/turn/tool-call
  // set, not build its own.
  const budgets = generateBudgets(rng, orgData.teams, runs, turns, toolCalls)

  return {
    org: orgData.org,
    teams: orgData.teams,
    engineers: orgData.engineers,
    models,
    runs,
    turns,
    toolCalls,
    artifacts,
    policyFlags,
    budgets,
  }
}
