-- 0001: everything the dashboard reads from.
-- Forward only. To change something, add 0002, never edit this file.
-- Written for SQLite but shaped for Postgres: whole cents in integers,
-- UTC text timestamps, TEXT + CHECK standing in for real enum types.

-- Foreign keys are NOT switched on here on purpose. In SQLite the setting belongs to a
-- connection, not to the database file, so a PRAGMA in this file would only cover the
-- migration itself and every later connection would quietly accept orphan rows.
-- It is set in src/db/connect.ts instead, which every connection goes through.

CREATE TABLE orgs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  licensed_seats  INTEGER NOT NULL CHECK (licensed_seats >= 0),
  created_at      TEXT NOT NULL
);

CREATE TABLE teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES orgs(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE engineers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES orgs(id),
  team_id          INTEGER REFERENCES teams(id),
  handle           TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  seat_granted_at  TEXT NOT NULL,
  seat_active      INTEGER NOT NULL DEFAULT 1 CHECK (seat_active IN (0, 1)),
  UNIQUE (org_id, handle)
);

CREATE TABLE models (
  id                                 INTEGER PRIMARY KEY AUTOINCREMENT,
  provider                           TEXT NOT NULL,
  name                               TEXT NOT NULL,
  input_price_per_mtok_cents         INTEGER NOT NULL CHECK (input_price_per_mtok_cents >= 0),
  cached_input_price_per_mtok_cents  INTEGER NOT NULL CHECK (cached_input_price_per_mtok_cents >= 0),
  cache_write_price_per_mtok_cents   INTEGER NOT NULL CHECK (cache_write_price_per_mtok_cents >= 0),
  output_price_per_mtok_cents        INTEGER NOT NULL CHECK (output_price_per_mtok_cents >= 0),
  effective_from                     TEXT NOT NULL,
  UNIQUE (provider, name, effective_from)
);

CREATE TABLE runs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                   INTEGER NOT NULL REFERENCES orgs(id),
  team_id                  INTEGER NOT NULL REFERENCES teams(id),
  engineer_id              INTEGER REFERENCES engineers(id),
  parent_run_id            INTEGER REFERENCES runs(id),
  agent_kind               TEXT NOT NULL,
  "trigger"                TEXT NOT NULL CHECK ("trigger" IN ('person', 'automation')),
  repo                     TEXT,
  branch                   TEXT,
  started_at               TEXT NOT NULL,
  actor_utc_offset_minutes INTEGER NOT NULL,
  finished_at              TEXT,
  status                   TEXT NOT NULL CHECK (status IN
                              ('running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  failure_cause            TEXT CHECK (failure_cause IN (
                              'missing_permission', 'missing_secret_or_login', 'tool_not_available',
                              'network_or_sandbox_blocked', 'hit_token_or_time_limit',
                              'dependency_install_failed', 'ran_out_of_context',
                              'infrastructure_crash', 'rate_limited', 'model_refused',
                              'tests_failed', 'nothing_useful_produced'
                            )),
  blame                    TEXT CHECK (blame IN ('org_setup', 'platform', 'task')),
  is_quiet_failure         INTEGER NOT NULL DEFAULT 0 CHECK (is_quiet_failure IN (0, 1)),
  duration_ms              INTEGER,
  total_cost_cents         INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_cents >= 0),
  turn_count               INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  tool_call_count          INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
  CHECK (
    (status IN ('running', 'succeeded', 'cancelled') AND failure_cause IS NULL AND blame IS NULL)
    OR
    (status IN ('failed', 'timed_out') AND failure_cause IS NOT NULL AND blame IS NOT NULL)
  ),
  CHECK (is_quiet_failure = 0 OR status = 'succeeded'),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TRIGGER runs_parent_must_be_first
BEFORE INSERT ON runs
WHEN NEW.parent_run_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'parent_run_id must point at the first run of the chain')
  WHERE (SELECT parent_run_id FROM runs WHERE id = NEW.parent_run_id) IS NOT NULL;
END;

CREATE TABLE turns (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER NOT NULL REFERENCES runs(id),
  turn_index          INTEGER NOT NULL CHECK (turn_index >= 0),
  model_id            INTEGER NOT NULL REFERENCES models(id),
  tokens_in_fresh     INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in_fresh >= 0),
  tokens_in_cached    INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in_cached >= 0),
  tokens_cache_write  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_cache_write >= 0),
  tokens_out          INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  tokens_thinking     INTEGER NOT NULL DEFAULT 0 CHECK (tokens_thinking >= 0),
  latency_ms          INTEGER NOT NULL CHECK (latency_ms >= 0),
  finish_reason       TEXT NOT NULL CHECK (finish_reason IN ('stop', 'tool_call', 'length', 'error')),
  cost_cents          INTEGER NOT NULL CHECK (cost_cents >= 0),
  started_at          TEXT NOT NULL,
  UNIQUE (run_id, turn_index)
);

CREATE TABLE tool_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES runs(id),
  turn_id     INTEGER NOT NULL REFERENCES turns(id),
  tool_name   TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome     TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'timeout')),
  target      TEXT,
  error_type  TEXT,
  cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  CHECK (outcome != 'error' OR error_type IS NOT NULL)
);

CREATE TABLE artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES runs(id),
  kind        TEXT NOT NULL CHECK (kind IN ('pull_request', 'commit', 'file', 'report')),
  ref         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  merged_at   TEXT,
  reverted_at TEXT,
  CHECK (reverted_at IS NULL OR merged_at IS NOT NULL)
);

CREATE TABLE policy_flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       INTEGER NOT NULL REFERENCES runs(id),
  turn_id      INTEGER REFERENCES turns(id),
  kind         TEXT NOT NULL CHECK (kind IN (
                 'suspected_prompt_injection', 'goal_hijacked', 'unsafe_tool_use',
                 'excess_access_requested', 'blocked_domain_attempt', 'secret_exposed',
                 'unsafe_command', 'attempted_exfiltration', 'spend_cap_crossed'
               )),
  severity     TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  disposition  TEXT NOT NULL CHECK (disposition IN
                 ('confirmed', 'expected_and_dismissed', 'under_review')),
  resource     TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  month       TEXT NOT NULL,
  limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0),
  warn_cents  INTEGER NOT NULL CHECK (warn_cents >= 0),
  stop_cents  INTEGER NOT NULL CHECK (stop_cents >= 0),
  updated_at  TEXT NOT NULL,
  UNIQUE (team_id, month),
  CHECK (warn_cents <= stop_cents AND stop_cents <= limit_cents)
);

-- Indexes. Each one serves a named number in docs/metrics.md.

-- Any org-wide screen that needs every team under it.
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);

-- Same, for people.
CREATE INDEX IF NOT EXISTS idx_engineers_org_id ON engineers(org_id);

-- A team's current roster.
CREATE INDEX IF NOT EXISTS idx_engineers_team_id ON engineers(team_id);

-- **Adoption rate**, **sticking rate** — both need "engineers with a run in a window", scoped to the org.
CREATE INDEX IF NOT EXISTS idx_runs_org_id_started_at ON runs(org_id, started_at);

-- **Depth of use** — needs each engineer's run count over the last 30 days, and their most recent run for the dormant/light/regular/deep split.
CREATE INDEX IF NOT EXISTS idx_runs_engineer_id_started_at ON runs(engineer_id, started_at);

-- Team-level, this-week screens: team success rate, team spend pace.
CREATE INDEX IF NOT EXISTS idx_runs_team_id_started_at ON runs(team_id, started_at);

-- **Finished tasks**, **cost per finished task**, **retry rate**, **success rate (in the end)** — every one of these first collapses a chain of retries to one task, and this index is what makes finding a chain's members fast.
CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id ON runs(parent_run_id);

-- **Success rate (first try)**, **failure rate by cause** — both filter to runs that reached an end within a rolling window, then split by status.
CREATE INDEX IF NOT EXISTS idx_runs_status_finished_at ON runs(status, finished_at);

-- **Failure rate by cause**, specifically the org-setup / platform / task split — a partial index, since most runs succeed and have no blame at all, so there's no reason to index them here.
CREATE INDEX IF NOT EXISTS idx_runs_blame ON runs(blame) WHERE blame IS NOT NULL;

-- **Quiet failures** — same reasoning: almost every row won't match, so only index the ones that do.
CREATE INDEX IF NOT EXISTS idx_runs_quiet_failure ON runs(org_id) WHERE is_quiet_failure = 1;

-- Rolling a run's turns up into its cost and token totals; also serves **cost per finished task**.
CREATE INDEX IF NOT EXISTS idx_turns_run_id ON turns(run_id);

-- Reporting cost or tokens by model.
CREATE INDEX IF NOT EXISTS idx_turns_model_id ON turns(model_id);

-- **Turn time p50/p95/p99** — the percentile queries need every turn in a window, ordered.
CREATE INDEX IF NOT EXISTS idx_turns_started_at ON turns(started_at);

-- Rolling a run's tool calls into its `tool_call_count`.
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id);

-- Joining a tool call back to the turn that made it.
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn_id ON tool_calls(turn_id);

-- Finding what a run produced.
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);

-- **What came out** (counts by kind) and **merged pull requests** specifically.
CREATE INDEX IF NOT EXISTS idx_artifacts_kind_merged_at ON artifacts(kind, merged_at);

-- Finding a run's flags.
CREATE INDEX IF NOT EXISTS idx_policy_flags_run_id ON policy_flags(run_id);

-- Finding a turn's flags.
CREATE INDEX IF NOT EXISTS idx_policy_flags_turn_id ON policy_flags(turn_id);

-- **Flags shown as a trend** — ranking "new for this team" needs each kind's history over time.
CREATE INDEX IF NOT EXISTS idx_policy_flags_kind_created_at ON policy_flags(kind, created_at);

-- How often a flag gets dismissed as expected.
CREATE INDEX IF NOT EXISTS idx_policy_flags_disposition ON policy_flags(disposition);

