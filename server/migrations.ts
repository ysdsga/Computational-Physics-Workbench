import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { WORKFLOWS } from '../src/data/workflows.js';

const AGENT_V1_SCHEMA_VERSION = 2;
const WORKBENCH_V2_SCHEMA_VERSION = 3;
const EXPERIENCE_PROVENANCE_SCHEMA_VERSION = 4;
const ESSENTIAL_WORKBENCH_SCHEMA_VERSION = 5;
const JOB_MONITOR_SCHEMA_VERSION = 6;
const THEORETICAL_EXPLORATION_SCHEMA_VERSION = 7;
const THEORETICAL_STAGE_REFLECTION_SCHEMA_VERSION = 8;
const THEORETICAL_IDEA_CLOSURE_SCHEMA_VERSION = 9;
const THEORETICAL_ACTIVE_EXPLORATION_SCHEMA_VERSION = 10;

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

function backupBeforeWorkbenchV2(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-workbench-v2.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function backupBeforeEssentialWorkbench(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-essential-v3.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function backupBeforeJobMonitor(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-job-monitor-v6.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function backupBeforeTheoreticalExploration(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-theoretical-exploration-v7.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function backupBeforeTheoreticalStageReflection(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-theoretical-stage-reflection-v8.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function backupBeforeTheoreticalIdeaClosure(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-theoretical-idea-closure-v9.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function backupBeforeTheoreticalActiveExploration(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:') return;
  const extension = path.extname(dbPath);
  const backupPath = path.join(
    path.dirname(dbPath),
    `${path.basename(dbPath, extension)}.before-theoretical-active-exploration-v10.db`,
  );
  if (fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
}

function tableCount(db: Database.Database, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

export function runMigrations(db: Database.Database, dbPath: string): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  if (currentVersion >= THEORETICAL_ACTIVE_EXPLORATION_SCHEMA_VERSION) return;

  if (currentVersion < JOB_MONITOR_SCHEMA_VERSION) backupBeforeAgentV1(db, dbPath);
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

  if (currentVersion < 3) {
    backupBeforeWorkbenchV2(db, dbPath);
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS run_actions (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          context_version_id TEXT NOT NULL REFERENCES run_context_versions(id) ON DELETE RESTRICT,
          step_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN (
            'proposed', 'authorized', 'executing', 'waiting_remote',
            'waiting_user', 'succeeded', 'failed', 'cancelled'
          )),
          executor TEXT NOT NULL DEFAULT 'codex' CHECK(executor = 'codex'),
          manifest_json TEXT NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          conversation_ref TEXT,
          authorization_summary TEXT,
          authorization_sha256 TEXT,
          authorized_at TEXT,
          started_at TEXT,
          finished_at TEXT,
          result_json TEXT NOT NULL DEFAULT '{}',
          error_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(run_id, idempotency_key)
        );

        CREATE INDEX IF NOT EXISTS idx_run_actions_timeline
          ON run_actions(run_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_run_actions_step
          ON run_actions(run_id, step_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS run_artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          context_version_id TEXT NOT NULL REFERENCES run_context_versions(id) ON DELETE RESTRICT,
          action_id TEXT NOT NULL REFERENCES run_actions(id) ON DELETE RESTRICT,
          remote_job_id TEXT REFERENCES remote_jobs(id) ON DELETE RESTRICT,
          step_id TEXT NOT NULL,
          location TEXT NOT NULL CHECK(location IN ('local', 'remote')),
          path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
          sha256 TEXT NOT NULL,
          category TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(action_id, idempotency_key)
        );

        CREATE INDEX IF NOT EXISTS idx_run_artifacts_run
          ON run_artifacts(run_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_run_artifacts_step
          ON run_artifacts(run_id, step_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS evidence_checks (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          context_version_id TEXT NOT NULL REFERENCES run_context_versions(id) ON DELETE RESTRICT,
          action_id TEXT NOT NULL REFERENCES run_actions(id) ON DELETE RESTRICT,
          artifact_id TEXT REFERENCES run_artifacts(id) ON DELETE RESTRICT,
          step_id TEXT NOT NULL,
          validator_name TEXT NOT NULL,
          validator_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pass', 'warn', 'fail')),
          result_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(action_id, idempotency_key)
        );

        CREATE INDEX IF NOT EXISTS idx_evidence_checks_run
          ON evidence_checks(run_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_evidence_checks_step
          ON evidence_checks(run_id, step_id, created_at DESC);
      `);

      if (!columnExists(db, 'remote_jobs', 'action_id')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN action_id TEXT REFERENCES run_actions(id) ON DELETE RESTRICT');
      }
      if (!columnExists(db, 'remote_jobs', 'step_id')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN step_id TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'remote_jobs', 'execution_manifest_json')) {
        db.exec("ALTER TABLE remote_jobs ADD COLUMN execution_manifest_json TEXT NOT NULL DEFAULT '{}'");
      }
      if (!columnExists(db, 'remote_jobs', 'execution_manifest_sha256')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN execution_manifest_sha256 TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'remote_jobs', 'script_sha256')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN script_sha256 TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'remote_jobs', 'resources_json')) {
        db.exec("ALTER TABLE remote_jobs ADD COLUMN resources_json TEXT NOT NULL DEFAULT '{}'");
      }
      if (!columnExists(db, 'remote_jobs', 'resources_sha256')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN resources_sha256 TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'review_requests', 'source')) {
        db.exec("ALTER TABLE review_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");
      }
      if (!columnExists(db, 'review_requests', 'conversation_ref')) {
        db.exec('ALTER TABLE review_requests ADD COLUMN conversation_ref TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'review_decisions', 'source')) {
        db.exec("ALTER TABLE review_decisions ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");
      }
      if (!columnExists(db, 'review_decisions', 'conversation_ref')) {
        db.exec('ALTER TABLE review_decisions ADD COLUMN conversation_ref TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'review_decisions', 'decision_sha256')) {
        db.exec('ALTER TABLE review_decisions ADD COLUMN decision_sha256 TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'run_events', 'source')) {
        db.exec("ALTER TABLE run_events ADD COLUMN source TEXT NOT NULL DEFAULT 'workbench'");
      }
      if (!columnExists(db, 'run_events', 'conversation_ref')) {
        db.exec('ALTER TABLE run_events ADD COLUMN conversation_ref TEXT DEFAULT NULL');
      }

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_jobs_action
          ON remote_jobs(action_id) WHERE action_id IS NOT NULL;
      `);
      db.pragma(`user_version = ${WORKBENCH_V2_SCHEMA_VERSION}`);
    })();
  }

  if (currentVersion < 4) db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS experience_promotions (
        experience_id TEXT PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
        context_version_id TEXT NOT NULL REFERENCES run_context_versions(id) ON DELETE RESTRICT,
        conclusion_event_id TEXT NOT NULL REFERENCES run_events(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL,
        promotion_summary_sha256 TEXT NOT NULL,
        conversation_ref TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS experience_promotion_artifacts (
        experience_id TEXT NOT NULL REFERENCES experience_promotions(experience_id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES run_artifacts(id) ON DELETE RESTRICT,
        action_id TEXT NOT NULL REFERENCES run_actions(id) ON DELETE RESTRICT,
        artifact_sha256 TEXT NOT NULL,
        PRIMARY KEY(experience_id, artifact_id)
      );

      CREATE INDEX IF NOT EXISTS idx_experience_promotions_run
        ON experience_promotions(run_id, created_at DESC);
    `);
    db.pragma(`user_version = ${EXPERIENCE_PROVENANCE_SCHEMA_VERSION}`);
  })();

  if (currentVersion < 5) {
    backupBeforeEssentialWorkbench(db, dbPath);

    // V4 was migrated into the formal database before any real run was
    // started. Fail closed if another installation already has V4 runtime
    // history: it needs an explicit archival conversion instead of a silent
    // destructive rewrite.
    const v4RuntimeTables = [
      'agent_policies',
      'research_runs',
      'run_context_versions',
      'run_events',
      'review_requests',
      'review_decisions',
      'remote_jobs',
      'run_actions',
      'run_artifacts',
      'evidence_checks',
      'experience_promotions',
      'experience_promotion_artifacts',
    ];
    const populated = v4RuntimeTables
      .map(table => ({ table, count: tableCount(db, table) }))
      .filter(item => item.count > 0);
    if (populated.length > 0) {
      throw new Error(`Schema v5 migration blocked: V4 runtime history is not empty (${populated.map(item => `${item.table}=${item.count}`).join(', ')})`);
    }

    db.transaction(() => {
      db.exec(`
        DROP TABLE experience_promotion_artifacts;
        DROP TABLE experience_promotions;
        DROP TABLE evidence_checks;
        DROP TABLE run_artifacts;
        DROP TABLE remote_jobs;
        DROP TABLE run_actions;
        DROP TABLE review_decisions;
        DROP TABLE review_requests;
        DROP TABLE run_events;
        DROP TABLE run_context_versions;
        DROP TABLE research_runs;
        DROP TABLE agent_policies;

        CREATE TABLE research_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
          research_plan_id TEXT NOT NULL REFERENCES research_plans(id) ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'waiting_researcher', 'completed', 'terminated')),
          objective TEXT NOT NULL,
          confirmed_envelope_json TEXT NOT NULL,
          working_plan_json TEXT NOT NULL DEFAULT '{}',
          envelope_revision INTEGER NOT NULL DEFAULT 0 CHECK(envelope_revision >= 0),
          envelope_confirmed_at TEXT,
          envelope_confirmation_summary TEXT NOT NULL DEFAULT '',
          current_stage_id TEXT,
          idempotency_key TEXT NOT NULL,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(task_id, idempotency_key)
        );

        CREATE UNIQUE INDEX idx_research_runs_one_open_per_task
          ON research_runs(task_id)
          WHERE status IN ('draft', 'active', 'waiting_researcher');

        CREATE TABLE run_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          sequence INTEGER NOT NULL,
          category TEXT NOT NULL CHECK(category IN ('fact', 'inference', 'decision', 'conclusion')),
          event_type TEXT NOT NULL,
          actor_type TEXT NOT NULL CHECK(actor_type IN ('agent', 'researcher', 'system')),
          payload_json TEXT NOT NULL DEFAULT '{}',
          idempotency_key TEXT,
          source TEXT NOT NULL DEFAULT 'workbench',
          conversation_ref TEXT,
          occurred_at TEXT NOT NULL,
          UNIQUE(run_id, sequence)
        );

        CREATE UNIQUE INDEX idx_run_events_idempotency
          ON run_events(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX idx_run_events_timeline ON run_events(run_id, sequence);

        CREATE TABLE run_actions (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          stage_id TEXT NOT NULL,
          step_id TEXT,
          parent_action_id TEXT REFERENCES run_actions(id) ON DELETE RESTRICT,
          action_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN (
            'ready', 'executing', 'waiting_remote', 'waiting_codex',
            'waiting_researcher', 'succeeded', 'failed', 'cancelled'
          )),
          executor TEXT NOT NULL DEFAULT 'codex' CHECK(executor = 'codex'),
          spec_json TEXT NOT NULL,
          spec_sha256 TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          conversation_ref TEXT,
          started_at TEXT,
          finished_at TEXT,
          result_json TEXT NOT NULL DEFAULT '{}',
          error_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(run_id, idempotency_key)
        );

        CREATE INDEX idx_run_actions_timeline ON run_actions(run_id, created_at DESC);
        CREATE INDEX idx_run_actions_stage ON run_actions(run_id, stage_id, created_at DESC);

        CREATE TABLE remote_jobs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          action_id TEXT NOT NULL REFERENCES run_actions(id) ON DELETE RESTRICT,
          stage_id TEXT NOT NULL,
          action_token TEXT NOT NULL UNIQUE,
          idempotency_key TEXT NOT NULL,
          profile_id TEXT NOT NULL,
          host TEXT NOT NULL,
          remote_workdir TEXT NOT NULL,
          scheduler TEXT NOT NULL DEFAULT 'lsf',
          job_id TEXT,
          job_name TEXT NOT NULL,
          status TEXT NOT NULL,
          submission_spec_json TEXT NOT NULL DEFAULT '{}',
          script_sha256 TEXT,
          resources_json TEXT NOT NULL DEFAULT '{}',
          last_observation_json TEXT NOT NULL DEFAULT '{}',
          submit_stdout TEXT NOT NULL DEFAULT '',
          submit_stderr TEXT NOT NULL DEFAULT '',
          submitted_at TEXT,
          reconciled_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(run_id, idempotency_key)
        );

        CREATE UNIQUE INDEX idx_remote_jobs_scheduler_id
          ON remote_jobs(host, scheduler, job_id) WHERE job_id IS NOT NULL;
        CREATE INDEX idx_remote_jobs_run ON remote_jobs(run_id, created_at DESC);
        CREATE INDEX idx_remote_jobs_stage ON remote_jobs(run_id, stage_id, created_at DESC);

        CREATE TABLE run_artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          action_id TEXT NOT NULL REFERENCES run_actions(id) ON DELETE RESTRICT,
          remote_job_id TEXT REFERENCES remote_jobs(id) ON DELETE RESTRICT,
          stage_id TEXT NOT NULL,
          location TEXT NOT NULL CHECK(location IN ('local', 'remote')),
          path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
          sha256 TEXT NOT NULL,
          category TEXT NOT NULL,
          validity TEXT NOT NULL DEFAULT 'valid' CHECK(validity IN ('valid', 'suspect', 'invalid', 'superseded')),
          superseded_by_id TEXT REFERENCES run_artifacts(id) ON DELETE RESTRICT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(action_id, idempotency_key)
        );

        CREATE INDEX idx_run_artifacts_run ON run_artifacts(run_id, created_at DESC);
        CREATE INDEX idx_run_artifacts_stage ON run_artifacts(run_id, stage_id, created_at DESC);

        CREATE TABLE evidence_checks (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          action_id TEXT NOT NULL REFERENCES run_actions(id) ON DELETE RESTRICT,
          artifact_id TEXT REFERENCES run_artifacts(id) ON DELETE RESTRICT,
          stage_id TEXT NOT NULL,
          validator_name TEXT NOT NULL,
          validator_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pass', 'warn', 'fail')),
          result_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(action_id, idempotency_key)
        );

        CREATE INDEX idx_evidence_checks_run ON evidence_checks(run_id, created_at DESC);
        CREATE INDEX idx_evidence_checks_stage ON evidence_checks(run_id, stage_id, created_at DESC);

        CREATE TABLE pending_items (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          stage_id TEXT,
          action_id TEXT REFERENCES run_actions(id) ON DELETE RESTRICT,
          remote_job_id TEXT REFERENCES remote_jobs(id) ON DELETE RESTRICT,
          audience TEXT NOT NULL CHECK(audience IN ('codex', 'researcher')),
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
          title TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}',
          resolution_json TEXT NOT NULL DEFAULT '{}',
          idempotency_key TEXT,
          source TEXT NOT NULL DEFAULT 'workbench',
          conversation_ref TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );

        CREATE UNIQUE INDEX idx_pending_items_idempotency
          ON pending_items(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX idx_pending_items_queue ON pending_items(audience, status, created_at DESC);
      `);

      if (!columnExists(db, 'experiences', 'category')) {
        db.exec("ALTER TABLE experiences ADD COLUMN category TEXT NOT NULL DEFAULT 'workflow'");
      }
      if (!columnExists(db, 'experiences', 'status')) {
        db.exec("ALTER TABLE experiences ADD COLUMN status TEXT NOT NULL DEFAULT 'manual'");
      }
      if (!columnExists(db, 'experiences', 'applicable_scope')) {
        db.exec("ALTER TABLE experiences ADD COLUMN applicable_scope TEXT NOT NULL DEFAULT ''");
      }
      if (!columnExists(db, 'experiences', 'source_run_id')) {
        db.exec('ALTER TABLE experiences ADD COLUMN source_run_id TEXT REFERENCES research_runs(id) ON DELETE SET NULL');
      }
      if (!columnExists(db, 'experiences', 'source_artifact_ids')) {
        db.exec("ALTER TABLE experiences ADD COLUMN source_artifact_ids TEXT NOT NULL DEFAULT '[]'");
      }
      if (!columnExists(db, 'experiences', 'source_kind')) {
        db.exec("ALTER TABLE experiences ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'researcher'");
      }

      db.pragma(`user_version = ${ESSENTIAL_WORKBENCH_SCHEMA_VERSION}`);
    })();
  }

  if (currentVersion < 6) {
    backupBeforeJobMonitor(db, dbPath);
    db.transaction(() => {
      if (!columnExists(db, 'run_actions', 'retry_of_action_id')) {
        db.exec('ALTER TABLE run_actions ADD COLUMN retry_of_action_id TEXT REFERENCES run_actions(id) ON DELETE RESTRICT');
      }
      if (!columnExists(db, 'run_actions', 'retry_attempt')) {
        db.exec('ALTER TABLE run_actions ADD COLUMN retry_attempt INTEGER NOT NULL DEFAULT 0 CHECK(retry_attempt >= 0)');
      }
      if (!columnExists(db, 'remote_jobs', 'next_check_at')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN next_check_at TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'remote_jobs', 'last_progress_at')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN last_progress_at TEXT DEFAULT NULL');
      }
      if (!columnExists(db, 'remote_jobs', 'queue_reason')) {
        db.exec("ALTER TABLE remote_jobs ADD COLUMN queue_reason TEXT NOT NULL DEFAULT ''");
      }
      if (!columnExists(db, 'remote_jobs', 'poll_count')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN poll_count INTEGER NOT NULL DEFAULT 0 CHECK(poll_count >= 0)');
      }
      if (!columnExists(db, 'remote_jobs', 'terminal_at')) {
        db.exec('ALTER TABLE remote_jobs ADD COLUMN terminal_at TEXT DEFAULT NULL');
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_run_actions_retry
          ON run_actions(retry_of_action_id) WHERE retry_of_action_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_remote_jobs_due
          ON remote_jobs(run_id, next_check_at) WHERE next_check_at IS NOT NULL;

        CREATE TABLE IF NOT EXISTS run_monitors (
          run_id TEXT PRIMARY KEY REFERENCES research_runs(id) ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK(status IN ('required', 'scheduled', 'paused', 'complete')),
          automation_ref TEXT,
          cadence_minutes INTEGER CHECK(cadence_minutes IS NULL OR cadence_minutes > 0),
          next_check_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_run_monitors_status
          ON run_monitors(status, next_check_at);
      `);
      db.pragma(`user_version = ${JOB_MONITOR_SCHEMA_VERSION}`);
    })();
  }

  if (currentVersion < 7) {
    const stored = db.prepare('SELECT data FROM workflow_templates WHERE id = ?')
      .get('theoretical-research') as { data: string } | undefined;
    if (stored) backupBeforeTheoreticalExploration(db, dbPath);
    db.transaction(() => {
      if (stored) {
        let data: { stages?: Array<{ id: string }>; steps?: Array<{ id: string }> };
        try {
          data = JSON.parse(stored.data) as typeof data;
        } catch {
          throw new Error('The theoretical-research workflow template is invalid JSON; database was left unchanged');
        }
        if (!Array.isArray(data.stages) || !Array.isArray(data.steps)) {
          throw new Error('The theoretical-research workflow template is missing stages or steps; database was left unchanged');
        }
        const builtIn = WORKFLOWS.find(workflow => workflow.id === 'theoretical-research');
        const reviewStep = builtIn?.steps.find(step => step.id === 'theory-interpretation-04');
        if (!reviewStep) {
          throw new Error('The built-in theoretical-research workflow is missing its exploration review step; database was left unchanged');
        }
        if (data.stages.some(stage => stage.id === reviewStep.stageId) && !data.steps.some(step => step.id === reviewStep.id)) {
          data.steps.push(reviewStep);
          db.prepare('UPDATE workflow_templates SET data = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(data), new Date().toISOString(), 'theoretical-research');
        }
      }
      db.pragma(`user_version = ${THEORETICAL_EXPLORATION_SCHEMA_VERSION}`);
    })();
  }

  if (currentVersion < THEORETICAL_STAGE_REFLECTION_SCHEMA_VERSION) {
    const stored = db.prepare('SELECT data FROM workflow_templates WHERE id = ?')
      .get('theoretical-research') as { data: string } | undefined;
    if (stored) backupBeforeTheoreticalStageReflection(db, dbPath);
    db.transaction(() => {
      if (stored) {
        let data: { stages?: Array<{ id: string }>; steps?: Array<{ id: string; name?: string }> };
        try {
          data = JSON.parse(stored.data) as typeof data;
        } catch {
          throw new Error('The theoretical-research workflow template is invalid JSON; database was left unchanged');
        }
        if (!Array.isArray(data.stages) || !Array.isArray(data.steps)) {
          throw new Error('The theoretical-research workflow template is missing stages or steps; database was left unchanged');
        }
        const builtIn = WORKFLOWS.find(workflow => workflow.id === 'theoretical-research');
        const reflectionSteps = builtIn?.steps.filter(step => step.id.endsWith('-reflection') || step.id === 'theory-interpretation-04') ?? [];
        if (reflectionSteps.length !== builtIn?.stages.length) {
          throw new Error('The built-in theoretical-research workflow is missing stage reflection steps; database was left unchanged');
        }
        for (const reflectionStep of reflectionSteps) {
          if (!data.stages.some(stage => stage.id === reflectionStep.stageId)) continue;
          const existingIndex = data.steps.findIndex(step => step.id === reflectionStep.id);
          if (existingIndex < 0) data.steps.push(reflectionStep);
          else if (reflectionStep.id === 'theory-interpretation-04' && data.steps[existingIndex].name === '审查关键问题与启发性想法') {
            data.steps[existingIndex] = reflectionStep;
          }
        }
        db.prepare('UPDATE workflow_templates SET data = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(data), new Date().toISOString(), 'theoretical-research');
      }
      db.pragma(`user_version = ${THEORETICAL_STAGE_REFLECTION_SCHEMA_VERSION}`);
    })();
  }

  if (currentVersion < THEORETICAL_IDEA_CLOSURE_SCHEMA_VERSION) {
    const stored = db.prepare('SELECT data FROM workflow_templates WHERE id = ?')
      .get('theoretical-research') as { data: string } | undefined;
    if (stored) backupBeforeTheoreticalIdeaClosure(db, dbPath);
    db.transaction(() => {
      if (stored) {
        let data: { steps?: Array<{ id: string; name?: string; description?: string }> };
        try {
          data = JSON.parse(stored.data) as typeof data;
        } catch {
          throw new Error('The theoretical-research workflow template is invalid JSON; database was left unchanged');
        }
        if (!Array.isArray(data.steps)) {
          throw new Error('The theoretical-research workflow template is missing steps; database was left unchanged');
        }
        const builtIn = WORKFLOWS.find(workflow => workflow.id === 'theoretical-research');
        if (!builtIn) {
          throw new Error('The built-in theoretical-research workflow is missing; database was left unchanged');
        }
        const previousReflectionDescription = '记录本阶段已经确定的结果、仍存的不确定性以及新出现的关键问题或启发性想法，并逐项给出探索、证伪、暂缓或转后续任务的处置。根据影响范围继续前进、停留修正，或回到最早受影响的核心阶段；完整记录追加到 Run 时间线，回流目标和下一步写入 Working Plan。';
        const previousInterpretationDescription = '完成本阶段记录与全局探索充分性审查。检查是否仍有可能改变、扩展或推翻中心结论的高价值问题或新想法；若有则回到最早受影响阶段，若无则把探索审查标记为通过并进入成果封装。';
        let changed = false;
        for (const step of data.steps) {
          const builtInStep = builtIn.steps.find(item => item.id === step.id);
          if (!builtInStep) continue;
          const isPreviousReflection = step.id.endsWith('-reflection')
            && step.name === '记录、反思与下一步判断'
            && step.description === previousReflectionDescription;
          const isPreviousInterpretation = step.id === 'theory-interpretation-04'
            && step.name === '记录、反思与探索充分性审查'
            && step.description === previousInterpretationDescription;
          if (!isPreviousReflection && !isPreviousInterpretation) continue;
          step.description = builtInStep.description;
          changed = true;
        }
        if (changed) {
          db.prepare('UPDATE workflow_templates SET data = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(data), new Date().toISOString(), 'theoretical-research');
        }
      }
      db.pragma(`user_version = ${THEORETICAL_IDEA_CLOSURE_SCHEMA_VERSION}`);
    })();
  }

  if (currentVersion < THEORETICAL_ACTIVE_EXPLORATION_SCHEMA_VERSION) {
    const stored = db.prepare('SELECT data FROM workflow_templates WHERE id = ?')
      .get('theoretical-research') as { data: string } | undefined;
    if (stored) backupBeforeTheoreticalActiveExploration(db, dbPath);
    db.transaction(() => {
      if (stored) {
        let data: { steps?: Array<{ id: string; name?: string; description?: string }> };
        try {
          data = JSON.parse(stored.data) as typeof data;
        } catch {
          throw new Error('The theoretical-research workflow template is invalid JSON; database was left unchanged');
        }
        if (!Array.isArray(data.steps)) {
          throw new Error('The theoretical-research workflow template is missing steps; database was left unchanged');
        }
        const builtIn = WORKFLOWS.find(workflow => workflow.id === 'theoretical-research');
        if (!builtIn) {
          throw new Error('The built-in theoretical-research workflow is missing; database was left unchanged');
        }
        const previousReflectionDescription = '记录本阶段已经确定的结果、仍存的不确定性以及新出现的关键问题或启发性想法，并逐项给出处置。高价值想法只有在引用证据并标记为已解决或已证伪后才闭合；暂缓或转后续任务仍保持未决。根据影响范围继续前进、停留修正，或回到最早受影响的核心阶段；完整记录追加到 Run 时间线，回流目标和下一步写入 Working Plan。';
        const previousInterpretationDescription = '完成本阶段记录与全局探索充分性审查。检查是否仍有可能改变、扩展或推翻中心结论的高价值问题或新想法；暂缓或转后续任务不能解除阻塞，只有引用证据的已解决或已证伪结论才能闭合。仍有未决项则回到最早受影响阶段，否则把探索审查标记为通过并进入成果封装。';
        let changed = false;
        for (const step of data.steps) {
          const builtInStep = builtIn.steps.find(item => item.id === step.id);
          if (!builtInStep) continue;
          const isPreviousReflection = step.id.endsWith('-reflection')
            && step.name === '记录、反思与下一步判断'
            && step.description === previousReflectionDescription;
          const isPreviousInterpretation = step.id === 'theory-interpretation-04'
            && step.name === '记录、反思与探索充分性审查'
            && step.description === previousInterpretationDescription;
          if (!isPreviousReflection && !isPreviousInterpretation) continue;
          step.description = builtInStep.description;
          changed = true;
        }
        if (changed) {
          db.prepare('UPDATE workflow_templates SET data = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(data), new Date().toISOString(), 'theoretical-research');
        }
      }
      db.pragma(`user_version = ${THEORETICAL_ACTIVE_EXPLORATION_SCHEMA_VERSION}`);
    })();
  }
}
