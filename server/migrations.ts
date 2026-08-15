import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

const AGENT_V1_SCHEMA_VERSION = 2;

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some(item => item.name === column);
}

function backupBeforeAgentV1(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-agent-v1.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

export function runMigrations(db: Database.Database, dbPath: string): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  if (currentVersion >= AGENT_V1_SCHEMA_VERSION) return;

  backupBeforeAgentV1(db, dbPath);
  if (currentVersion < 1) db.transaction(() => {
    if (!columnExists(db, 'tasks', 'task_root_rel')) {
      db.exec('ALTER TABLE tasks ADD COLUMN task_root_rel TEXT DEFAULT NULL');
    }
    if (!columnExists(db, 'projects', 'status')) {
      db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_policies (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('system', 'project', 'task')),
        scope_id TEXT,
        scope_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'retired')),
        policy_json TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        UNIQUE(scope_type, scope_key, version)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_policies_active_scope
        ON agent_policies(scope_type, scope_key) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS research_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
        research_plan_id TEXT NOT NULL REFERENCES research_plans(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK(status IN ('active', 'waiting_review', 'completed', 'terminated')),
        current_context_version_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_research_runs_one_open_per_task
        ON research_runs(task_id) WHERE status IN ('active', 'waiting_review');

      CREATE TABLE IF NOT EXISTS run_context_versions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        plan_content TEXT NOT NULL,
        plan_sha256 TEXT NOT NULL,
        contract_content TEXT NOT NULL,
        contract_sha256 TEXT NOT NULL,
        workflow_json TEXT NOT NULL,
        workflow_sha256 TEXT NOT NULL,
        effective_policy_json TEXT NOT NULL,
        policy_sha256 TEXT NOT NULL,
        adopted_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(run_id, version)
      );

      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
        context_version_id TEXT REFERENCES run_context_versions(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('fact', 'inference', 'decision', 'conclusion')),
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK(actor_type IN ('agent', 'researcher', 'system')),
        payload_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT,
        occurred_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_idempotency
        ON run_events(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_run_events_timeline ON run_events(run_id, sequence);

      CREATE TABLE IF NOT EXISTS review_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
        context_version_id TEXT NOT NULL REFERENCES run_context_versions(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK(status IN ('open', 'decided', 'superseded')),
        gate_type TEXT NOT NULL,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        recommendation_json TEXT NOT NULL DEFAULT '{}',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        proposal_json TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_review_requests_open ON review_requests(status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_idempotency
        ON review_requests(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS review_decisions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE REFERENCES review_requests(id) ON DELETE RESTRICT,
        decision TEXT NOT NULL CHECK(decision IN ('approve', 'reject', 'supplement', 'terminate')),
        comment TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT 'researcher',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS remote_jobs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
        context_version_id TEXT NOT NULL REFERENCES run_context_versions(id) ON DELETE RESTRICT,
        action_token TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL,
        host TEXT NOT NULL,
        remote_root TEXT NOT NULL,
        remote_workdir TEXT NOT NULL,
        scheduler TEXT NOT NULL DEFAULT 'lsf',
        job_id TEXT,
        job_name TEXT NOT NULL,
        status TEXT NOT NULL,
        submit_stdout TEXT NOT NULL DEFAULT '',
        submit_stderr TEXT NOT NULL DEFAULT '',
        last_observation_json TEXT NOT NULL DEFAULT '{}',
        submitted_at TEXT,
        reconciled_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, idempotency_key)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_jobs_scheduler_id
        ON remote_jobs(host, scheduler, job_id) WHERE job_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_remote_jobs_run ON remote_jobs(run_id, created_at DESC);
    `);
    db.pragma('user_version = 1');
  })();

  if (currentVersion < 2) db.transaction(() => {
    if (!columnExists(db, 'review_requests', 'idempotency_key')) {
      db.exec('ALTER TABLE review_requests ADD COLUMN idempotency_key TEXT DEFAULT NULL');
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_idempotency
        ON review_requests(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    `);
    db.pragma(`user_version = ${AGENT_V1_SCHEMA_VERSION}`);
  })();
}
