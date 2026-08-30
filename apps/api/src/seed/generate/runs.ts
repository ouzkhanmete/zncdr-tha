import type { Rng } from "../rng.ts"
import {
  AGENT_KINDS_NO_REPO,
  AGENT_KINDS_WITH_REPO,
  DEFAULT_TASK_SUMMARIES,
  ERROR_TYPES,
  METERED_TOOL_RATES_CENTS_PER_HOUR,
  NEW_TEAM_STRUGGLE,
  NOVA_BAD_WEEK_END_DAY,
  NOVA_BAD_WEEK_START_DAY,
  REPOS,
  TASK_SUMMARIES_BY_AGENT_KIND,
  TOOL_NAMES,
  TOTAL_DAYS,
  dateForDay,
  isWeekend,
  toIso,
} from "../config.ts"
import { pickFailure, statusForFailureCause } from "./failures.ts"
import { availableModelNames, priceRowFor, type GeneratedModel } from "./models.ts"
import type { GeneratedEngineer, GeneratedOrgData, GeneratedTeam } from "./org.ts"

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "timed_out"

export interface GeneratedRun {
  id: number
  orgId: number
  teamId: number
  engineerId: number | null
  parentRunId: number | null
  agentKind: string
  trigger: "person" | "automation"
  repo: string | null
  branch: string | null
  startedAt: string
  startedAtMs: number
  actorUtcOffsetMinutes: number
  finishedAt: string | null
  status: RunStatus
  failureCause: string | null
  blame: string | null
  isQuietFailure: boolean
  durationMs: number | null
  totalCostCents: number
  turnCount: number
  toolCallCount: number
  taskSummary: string
}

export interface GeneratedTurn {
  id: number
  runId: number
  turnIndex: number
  modelId: number
  tokensInFresh: number
  tokensInCached: number
  tokensCacheWrite: number
  tokensOut: number
  tokensThinking: number
  latencyMs: number
  finishReason: "stop" | "tool_call" | "length" | "error"
  costCents: number
  startedAt: string
}

export interface GeneratedToolCall {
  id: number
  runId: number
  turnId: number
  toolName: string
  durationMs: number
  outcome: "success" | "error" | "timeout"
  target: string | null
  errorType: string | null
  costCents: number
}

export interface GeneratedArtifact {
  id: number
  runId: number
  kind: "pull_request" | "commit" | "file" | "report"
  ref: string
  createdAt: string
  mergedAt: string | null
  revertedAt: string | null
}

export interface GeneratedRunData {
  runs: GeneratedRun[]
  turns: GeneratedTurn[]
  toolCalls: GeneratedToolCall[]
  artifacts: GeneratedArtifact[]
}

const TIMEOUT_LIMIT_MS = 30 * 60 * 1000 // 30 minutes -- every timed-out run is capped here.

// Weight of a run starting in each UTC hour. Bunches up 8am-7pm, a real midday dip at 12-13,
// tapering rather than stopping outside those hours -- "a few keen people always run something
// at 11pm" is the small but non-zero weight on hour 23. See docs/seed-data.md.
const HOUR_WEIGHTS = [2, 1, 1, 1, 1, 1, 2, 4, 8, 10, 10, 9, 6, 6, 9, 10, 10, 9, 7, 5, 3, 3, 2, 3]
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const BRANCH_SLUGS = ["auth", "billing", "search", "onboarding", "exports", "alerts", "sync", "perf"] as const

const MODEL_PICK_WEIGHTS: Record<string, number> = {
  "legacy-helper": 35,
  "quickpatch-1": 40,
  "steady-coder": 30,
  "deep-thinker": 22,
}

type CostTier = "trivial" | "bandB" | "bandC"

function pickCostTier(rng: Rng, modelName: string): CostTier {
  const isDeepThinker = modelName === "deep-thinker"
  const bandCProb = isDeepThinker ? 0.012 : 0.004
  const bandBProb = isDeepThinker ? 0.25 : 0.045
  const roll = rng.next()
  if (roll < bandCProb) return "bandC"
  if (roll < bandCProb + bandBProb) return "bandB"
  return "trivial"
}

/** The dollar range each tier draws from -- see docs/seed-data.md's long-tail cost story. */
function targetCostCentsForTier(rng: Rng, tier: CostTier): number {
  switch (tier) {
    case "trivial":
      // Skewed toward the cheap end: most of the org's runs cost well under a dollar.
      return Math.round(2 + rng.next() * rng.next() * 93)
    case "bandB":
      // $10-$40, mostly deep-thinker runs with heavy thinking or tool time.
      return rng.int(1000, 4000)
    case "bandC":
      // The runaway-loop tail: a couple of these a week, across the whole org.
      return Math.round(10000 + rng.next() * rng.next() * 40000)
  }
}

function pickTurnCount(rng: Rng, tier: CostTier, cancelledEarly: boolean): number {
  if (cancelledEarly) return 0
  if (tier === "bandC") return rng.int(18, 55) // stuck in a loop
  if (rng.chance(0.05)) return rng.int(15, 40) // an ordinary long task
  return Math.max(1, Math.round(2 + rng.next() * rng.next() * 10))
}

const NORMAL_SHARES = { fresh: 0.3, cached: 0.1, cacheWrite: 0.05, output: 0.45, thinking: 0.1 }
const THINKING_HEAVY_SHARES = { fresh: 0.15, cached: 0.05, cacheWrite: 0.05, output: 0.25, thinking: 0.5 }

/** Random positive weights, normalized to sum to 1 -- how one run's cost splits across its turns. */
function splitShares(rng: Rng, count: number): number[] {
  const raw = Array.from({ length: count }, () => rng.next() ** 1.5 + 0.05)
  const total = raw.reduce((a, b) => a + b, 0)
  return raw.map((r) => r / total)
}

function tokensForCostShare(targetCents: number, shares: typeof NORMAL_SHARES, model: GeneratedModel) {
  const perToken = (pricePerMtokCents: number) => pricePerMtokCents / 1_000_000
  const tokensFor = (share: number, pricePerMtokCents: number) =>
    pricePerMtokCents === 0 ? 0 : Math.max(0, Math.round((targetCents * share) / perToken(pricePerMtokCents)))
  return {
    tokensInFresh: tokensFor(shares.fresh, model.inputPricePerMtokCents),
    tokensInCached: tokensFor(shares.cached, model.cachedInputPricePerMtokCents),
    tokensCacheWrite: tokensFor(shares.cacheWrite, model.cacheWritePricePerMtokCents),
    tokensOut: tokensFor(shares.output, model.outputPricePerMtokCents),
    tokensThinking: tokensFor(shares.thinking, model.outputPricePerMtokCents),
  }
}

function actualCostCents(
  tokens: ReturnType<typeof tokensForCostShare>,
  model: GeneratedModel,
): number {
  const cost =
    (tokens.tokensInFresh * model.inputPricePerMtokCents) / 1_000_000 +
    (tokens.tokensInCached * model.cachedInputPricePerMtokCents) / 1_000_000 +
    (tokens.tokensCacheWrite * model.cacheWritePricePerMtokCents) / 1_000_000 +
    (tokens.tokensOut * model.outputPricePerMtokCents) / 1_000_000 +
    (tokens.tokensThinking * model.outputPricePerMtokCents) / 1_000_000
  return Math.max(0, Math.round(cost))
}

interface IdCounters {
  run: number
  turn: number
  toolCall: number
  artifact: number
}

function taskSummaryFor(rng: Rng, agentKind: string): string {
  return rng.pick(TASK_SUMMARIES_BY_AGENT_KIND[agentKind] ?? DEFAULT_TASK_SUMMARIES)
}

function pickTaskShape(
  rng: Rng,
): { agentKind: string; repo: string | null; branch: string | null; taskSummary: string } {
  if (rng.chance(0.12)) {
    const agentKind = rng.pick(AGENT_KINDS_NO_REPO)
    return { agentKind, repo: null, branch: null, taskSummary: taskSummaryFor(rng, agentKind) }
  }
  const repo = rng.pick(REPOS)
  const branch = rng.chance(0.35) ? "main" : `feature/${rng.pick(BRANCH_SLUGS)}-${rng.int(100, 999)}`
  const agentKind = rng.pick(AGENT_KINDS_WITH_REPO)
  return { agentKind, repo, branch, taskSummary: taskSummaryFor(rng, agentKind) }
}

function pickStartDate(rng: Rng, day: number): Date {
  const hour = rng.weightedPick(HOURS, HOUR_WEIGHTS)
  const minute = rng.int(0, 59)
  const second = rng.int(0, 59)
  return new Date(dateForDay(day).getTime() + hour * 3_600_000 + minute * 60_000 + second * 1000)
}

function makeRef(rng: Rng, kind: GeneratedArtifact["kind"], run: GeneratedRun): string {
  switch (kind) {
    case "pull_request":
      return `#${rng.int(1000, 9999)}`
    case "commit":
      return Array.from({ length: 7 }, () => rng.pick("0123456789abcdef".split(""))).join("")
    case "file":
      return `${run.repo ?? "misc"}/generated/${rng.pick(["report", "output", "notes"])}-${rng.int(100, 999)}.md`
    case "report":
      return `report-${run.id}`
  }
}

function generateArtifactsForRun(
  rng: Rng,
  run: GeneratedRun,
  ids: IdCounters,
  out: GeneratedArtifact[],
): void {
  if (run.status !== "succeeded") {
    // A run that failed partway can still leave a stray file or a half-written report behind.
    if ((run.status === "failed" || run.status === "timed_out") && rng.chance(0.04)) {
      pushArtifact(rng, run, run.repo ? "file" : "report", ids, out)
    }
    return
  }
  if (!rng.chance(0.82)) return // most successful runs produce something, not literally all
  const count = rng.chance(0.12) ? 2 : 1
  for (let i = 0; i < count; i++) {
    const kind = run.repo ? rng.weightedPick(["pull_request", "commit"] as const, [65, 35]) : rng.pick(["report", "file"] as const)
    pushArtifact(rng, run, kind, ids, out)
  }
}

function pushArtifact(
  rng: Rng,
  run: GeneratedRun,
  kind: GeneratedArtifact["kind"],
  ids: IdCounters,
  out: GeneratedArtifact[],
): void {
  const createdAt = new Date((run.finishedAt ? new Date(run.finishedAt).getTime() : run.startedAtMs) + rng.int(1, 600) * 1000)
  let mergedAt: string | null = null
  let revertedAt: string | null = null
  if (kind === "pull_request" && rng.chance(0.7)) {
    const mergeDelayMs = rng.int(1, 96) * 3_600_000 // merged somewhere from an hour to 4 days later
    mergedAt = toIso(new Date(createdAt.getTime() + mergeDelayMs))
    if (rng.chance(0.08)) {
      const revertDelayDays = rng.int(1, 40)
      revertedAt = toIso(new Date(new Date(mergedAt).getTime() + revertDelayDays * 86_400_000))
    }
  }
  out.push({
    id: ids.artifact++,
    runId: run.id,
    kind,
    ref: makeRef(rng, kind, run),
    createdAt: toIso(createdAt),
    mergedAt,
    revertedAt,
  })
}

interface RunRequest {
  org: GeneratedOrgData["org"]
  team: GeneratedTeam
  engineer: GeneratedEngineer | null
  trigger: "person" | "automation"
  parentRunId: number | null
  startedAt: Date
  day: number
  /** First-attempt shape a retry must copy, rather than rolling its own. */
  shape?: { agentKind: string; repo: string | null; branch: string | null; taskSummary: string }
  forceRunning?: boolean
}

/** Builds one run and every turn, tool call, and artifact underneath it. */
function generateOneRun(
  rng: Rng,
  models: readonly GeneratedModel[],
  req: RunRequest,
  ids: IdCounters,
  out: GeneratedRunData,
): GeneratedRun {
  const shape = req.shape ?? pickTaskShape(rng)
  const availableNames = availableModelNames(models, req.day)
  const modelName = rng.weightedPick(
    availableNames,
    availableNames.map((n) => MODEL_PICK_WEIGHTS[n] ?? 10),
  )

  const cancelledEarly = req.trigger === "person" && rng.chance(0.018)
  const cancelledLate = req.trigger === "person" && !cancelledEarly && rng.chance(0.02)
  const forceRunning = req.forceRunning === true

  let status: RunStatus
  let failureCause: string | null = null
  let blame: string | null = null

  if (forceRunning) {
    status = "running"
  } else if (cancelledEarly || cancelledLate) {
    status = "cancelled"
  } else {
    const reliabilityMultiplier =
      modelName === "quickpatch-1" ? 1.4 : modelName === "deep-thinker" ? 0.6 : modelName === "legacy-helper" ? 1.1 : 1.0
    const teamAgeDays = req.day - req.team.adoptionDay
    // Pinnacle is still finding its footing (see docs/seed-data.md and NEW_TEAM_STRUGGLE) --
    // while it's inside its first-30-days org-setup-heavy window, its runs fail a bit more often
    // than the org baseline, on top of whichever model it happened to draw.
    const struggleMultiplier =
      req.team.name === NEW_TEAM_STRUGGLE.teamName && teamAgeDays < 30 ? NEW_TEAM_STRUGGLE.failProbMultiplier : 1.0
    const baseFailProb = 0.17 * reliabilityMultiplier * struggleMultiplier
    if (rng.chance(baseFailProb)) {
      const picked = pickFailure(rng, teamAgeDays, req.team.name)
      failureCause = picked.failureCause
      blame = picked.blame
      status = statusForFailureCause(failureCause)
    } else {
      status = "succeeded"
    }
  }

  const tier: CostTier = status === "cancelled" || status === "running" ? "trivial" : pickCostTier(rng, modelName)
  const targetCostCents = status === "cancelled" && cancelledEarly ? 0 : targetCostCentsForTier(rng, tier)
  const turnCount = forceRunning
    ? rng.int(1, 4)
    : cancelledLate
      ? rng.int(1, 5) // cancelled after some real work, not a marathon
      : pickTurnCount(rng, tier, cancelledEarly)

  const shares = modelName === "deep-thinker" && tier !== "trivial" ? THINKING_HEAVY_SHARES : NORMAL_SHARES
  const perTurnShare = turnCount > 0 ? splitShares(rng, turnCount) : []

  let totalCostCents = 0
  let turnCursorMs = req.startedAt.getTime()
  const runTurns: GeneratedTurn[] = []
  const runToolCalls: GeneratedToolCall[] = []
  let toolTimeShare = 0
  if (tier !== "trivial" && rng.chance(0.35)) toolTimeShare = rng.float(0.15, 0.45)

  for (let i = 0; i < turnCount; i++) {
    const turnTargetCents = targetCostCents * (1 - toolTimeShare) * (perTurnShare[i] ?? 0)
    const priceRow = priceRowFor(models, modelName, new Date(turnCursorMs))
    const tokens = tokensForCostShare(turnTargetCents, shares, priceRow)
    const costCents = actualCostCents(tokens, priceRow)
    const latencyMs =
      shares === THINKING_HEAVY_SHARES ? rng.int(3000, 60000) : rng.int(600, 15000)
    const finishReason =
      status === "failed" && i === turnCount - 1
        ? rng.pick(["error", "length"] as const)
        : rng.weightedPick(["stop", "tool_call", "length", "error"] as const, [55, 35, 6, 4])

    runTurns.push({
      id: ids.turn++,
      runId: 0, // filled in once the run's real id is known
      turnIndex: i,
      modelId: priceRow.id,
      ...tokens,
      latencyMs,
      finishReason,
      costCents,
      startedAt: toIso(new Date(turnCursorMs)),
    })
    totalCostCents += costCents

    // Tool calls inside this turn -- most turns make one or two, plenty make none.
    const toolCallCount = rng.poisson(2.0)
    for (let t = 0; t < toolCallCount; t++) {
      const toolName = rng.pick(TOOL_NAMES)
      const outcome = rng.weightedPick(["success", "error", "timeout"] as const, [85, 12, 3])
      const durationMs = rng.int(50, 8000)
      const meteredRate = METERED_TOOL_RATES_CENTS_PER_HOUR[toolName]
      const cost = meteredRate ? Math.round((durationMs / 3_600_000) * meteredRate) : 0
      runToolCalls.push({
        id: ids.toolCall++,
        runId: 0,
        turnId: runTurns[runTurns.length - 1]!.id,
        toolName,
        durationMs,
        outcome,
        target: rng.chance(0.6) ? `${shape.repo ?? "resource"}/${rng.pick(["src", "lib", "test", "config"])}` : null,
        errorType: outcome === "error" ? rng.pick(ERROR_TYPES) : null,
        costCents: cost,
      })
    }

    turnCursorMs += latencyMs + rng.int(200, 3000)
  }

  // A slice of the target cost meant to represent heavy tool/sandbox time rather than tokens,
  // charged as one extra metered call on the run's last turn -- see docs/seed-data.md's "a lot
  // of tool time" line.
  if (toolTimeShare > 0 && runTurns.length > 0) {
    const meteredName = rng.pick(["test_runner", "browser"] as const)
    const rate = METERED_TOOL_RATES_CENTS_PER_HOUR[meteredName]!
    const toolCostCents = Math.round(targetCostCents * toolTimeShare)
    const durationMs = Math.round((toolCostCents / rate) * 3_600_000)
    runToolCalls.push({
      id: ids.toolCall++,
      runId: 0,
      turnId: runTurns[runTurns.length - 1]!.id,
      toolName: meteredName,
      durationMs,
      outcome: "success",
      target: null,
      errorType: null,
      costCents: toolCostCents,
    })
    totalCostCents += toolCostCents
    turnCursorMs += durationMs
  }

  const isQuietFailure = status === "succeeded" && rng.chance(modelName === "quickpatch-1" ? 0.035 : 0.02)

  let finishedAt: string | null
  let durationMs: number | null
  if (status === "running") {
    finishedAt = null
    durationMs = null
  } else if (status === "timed_out") {
    finishedAt = toIso(new Date(req.startedAt.getTime() + TIMEOUT_LIMIT_MS))
    durationMs = TIMEOUT_LIMIT_MS
  } else if (cancelledEarly) {
    durationMs = rng.int(500, 4999)
    finishedAt = toIso(new Date(req.startedAt.getTime() + durationMs))
  } else {
    durationMs = Math.max(1000, turnCursorMs - req.startedAt.getTime())
    finishedAt = toIso(new Date(req.startedAt.getTime() + durationMs))
  }

  const run: GeneratedRun = {
    id: ids.run++,
    orgId: req.org.id,
    teamId: req.team.id,
    engineerId: req.engineer?.id ?? null,
    parentRunId: req.parentRunId,
    agentKind: shape.agentKind,
    trigger: req.trigger,
    repo: shape.repo,
    branch: shape.branch,
    startedAt: toIso(req.startedAt),
    startedAtMs: req.startedAt.getTime(),
    actorUtcOffsetMinutes: req.engineer?.utcOffsetMinutes ?? 0,
    finishedAt,
    status,
    failureCause,
    blame,
    isQuietFailure,
    durationMs,
    totalCostCents,
    turnCount: runTurns.length,
    toolCallCount: runToolCalls.length,
    taskSummary: shape.taskSummary,
  }

  for (const turn of runTurns) turn.runId = run.id
  for (const call of runToolCalls) call.runId = run.id

  out.runs.push(run)
  out.turns.push(...runTurns)
  out.toolCalls.push(...runToolCalls)
  generateArtifactsForRun(rng, run, ids, out.artifacts)

  return run
}

/** How eager a chain is to try again, by attempt number and who's driving it. */
function retryProbability(attemptNumber: number, trigger: "person" | "automation", wasCancelled: boolean): number {
  if (wasCancelled) return attemptNumber === 1 ? 0.12 : 0
  const base = attemptNumber === 1 ? 0.42 : attemptNumber === 2 ? 0.22 : 0.08
  return trigger === "automation" ? Math.min(0.9, base + 0.15) : base
}

function generateChain(
  rng: Rng,
  models: readonly GeneratedModel[],
  base: Omit<RunRequest, "parentRunId" | "startedAt" | "shape">,
  startedAt: Date,
  ids: IdCounters,
  out: GeneratedRunData,
  forceRunning: boolean,
): void {
  const first = generateOneRun(rng, models, { ...base, parentRunId: null, startedAt, forceRunning }, ids, out)
  if (forceRunning) return // nothing to retry yet -- it hasn't resolved

  let current = first
  let attempt = 1
  const maxAttempts = 4
  while (attempt < maxAttempts) {
    const needsRetry = current.status === "failed" || current.status === "timed_out" || current.status === "cancelled"
    if (!needsRetry) break
    const prob = retryProbability(attempt, base.trigger, current.status === "cancelled")
    if (!rng.chance(prob)) break

    const gapMinutes = rng.chance(0.85) ? rng.int(2, 240) : rng.int(241, 1440)
    const nextStartMs = (current.finishedAt ? new Date(current.finishedAt).getTime() : current.startedAtMs) + gapMinutes * 60_000
    const nextDay = Math.floor((nextStartMs - dateForDay(1).getTime()) / 86_400_000) + 1
    if (nextDay > TOTAL_DAYS) break

    current = generateOneRun(
      rng,
      models,
      {
        ...base,
        parentRunId: first.id,
        startedAt: new Date(nextStartMs),
        day: nextDay,
        shape: {
          agentKind: first.agentKind,
          repo: first.repo,
          branch: first.branch,
          taskSummary: first.taskSummary,
        },
      },
      ids,
      out,
    )
    attempt++
  }
}

function rampFactor(teamAgeDays: number): number {
  const t = Math.min(Math.max(teamAgeDays, 0), 30) / 30
  return 0.25 + 0.75 * t
}

/**
 * Which team a run should be stamped with on a given day. Every engineer but one always returns
 * their own (unchanging) `teamId`. The one TEAM_MOVE picks (see config.ts and org.ts) returns
 * their old team before `moveDay` and their current team from `moveDay` on -- so their earlier
 * runs keep the old team's history and their later runs build the new team's, exactly like a real
 * reorg would, while `engineers.team_id` only ever shows where they are now.
 */
function engineerTeamIdForDay(engineer: GeneratedEngineer, day: number): number {
  if (!engineer.move) return engineer.teamId
  return day < engineer.move.moveDay ? engineer.move.previousTeamId : engineer.teamId
}

/**
 * Walks the whole 180-day window, day by day and team by team, generating every run (and its
 * turns, tool calls, and artifacts) for that day -- see docs/seed-data.md for the shape this is
 * meant to produce: weekday clustering, staggered adoption, dormant seats, a long-tailed cost
 * curve, and Nova's one bad week.
 */
export function generateRuns(rng: Rng, orgData: GeneratedOrgData, models: readonly GeneratedModel[]): GeneratedRunData {
  const out: GeneratedRunData = { runs: [], turns: [], toolCalls: [], artifacts: [] }
  const ids: IdCounters = { run: 1, turn: 1, toolCall: 1, artifact: 1 }

  const engineersByTeam = new Map<number, GeneratedEngineer[]>()
  const addToRoster = (teamId: number, engineer: GeneratedEngineer): void => {
    const list = engineersByTeam.get(teamId) ?? []
    list.push(engineer)
    engineersByTeam.set(teamId, list)
  }
  for (const engineer of orgData.engineers) {
    addToRoster(engineer.teamId, engineer)
    // The one engineer who moves teams (see engineerTeamIdForDay) also needs to show up in their
    // old team's roster, so their pre-move days still get processed there.
    if (engineer.move) addToRoster(engineer.move.previousTeamId, engineer)
  }

  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const weekend = isWeekend(day)
    const isLastDay = day === TOTAL_DAYS

    for (const team of orgData.teams) {
      if (day < team.adoptionDay) continue
      const teamAgeDays = day - team.adoptionDay
      const ramp = rampFactor(teamAgeDays)
      const isBadWeek = team.name === "Nova" && day >= NOVA_BAD_WEEK_START_DAY && day <= NOVA_BAD_WEEK_END_DAY
      const badWeekBoost = isBadWeek ? 2.4 : 1
      const weekendFactor = weekend ? 0.5 : 1

      const engineers = engineersByTeam.get(team.id) ?? []
      for (const engineer of engineers) {
        if (engineer.dormant) continue
        // A mover shows up in two rosters (their old team and their new one) -- only generate
        // for whichever team actually counts them on this particular day.
        if (engineerTeamIdForDay(engineer, day) !== team.id) continue
        const rate = engineer.weekdayMeanRuns * team.usageIntensity * ramp * badWeekBoost * weekendFactor
        const runsToday = rng.poisson(rate)
        for (let i = 0; i < runsToday; i++) {
          const startedAt = pickStartDate(rng, day)
          const hour = startedAt.getUTCHours()
          const forceRunning = isLastDay && hour >= 20 && rng.chance(0.5)
          generateChain(
            rng,
            models,
            { org: orgData.org, team, engineer, trigger: "person", day },
            startedAt,
            ids,
            out,
            forceRunning,
          )
        }
      }

      // Automation-triggered runs: a smaller, steady background of scheduled or CI-kicked tasks.
      const automationRate = 0.35 * ramp * (weekend ? 0.6 : 1) * (isBadWeek ? 1.6 : 1)
      const automationRuns = rng.poisson(automationRate)
      for (let i = 0; i < automationRuns; i++) {
        const startedAt = pickStartDate(rng, day)
        const hour = startedAt.getUTCHours()
        const forceRunning = isLastDay && hour >= 20 && rng.chance(0.5)
        generateChain(
          rng,
          models,
          { org: orgData.org, team, engineer: null, trigger: "automation", day },
          startedAt,
          ids,
          out,
          forceRunning,
        )
      }
    }
  }

  return out
}
