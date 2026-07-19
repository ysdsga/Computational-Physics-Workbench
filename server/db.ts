import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeTaskFolderName } from './taskFolders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DFT_DMFT_DB_PATH
  ? path.resolve(process.env.DFT_DMFT_DB_PATH)
  : path.join(__dirname, '..', 'data', 'workbench.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    material TEXT DEFAULT '',
    working_dir TEXT DEFAULT '',
    hpc_config TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    workflow_id TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    folder_name TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS step_progress (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    commands TEXT DEFAULT NULL,
    lsf_script TEXT DEFAULT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, step_id)
  );

  CREATE TABLE IF NOT EXISTS step_files (
    id TEXT PRIMARY KEY,
    step_progress_id TEXT NOT NULL REFERENCES step_progress(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_remote INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    related_project_id TEXT,
    related_task_id TEXT,
    related_step_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`);

function hasColumn(table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some(item => item.name === column);
}

const migrations = [
  { version: 1, name: 'step progress commands', run: () => {
    if (!hasColumn('step_progress', 'commands')) db.exec('ALTER TABLE step_progress ADD COLUMN commands TEXT DEFAULT NULL');
  } },
  { version: 2, name: 'step progress lsf script', run: () => {
    if (!hasColumn('step_progress', 'lsf_script')) db.exec('ALTER TABLE step_progress ADD COLUMN lsf_script TEXT DEFAULT NULL');
  } },
  { version: 3, name: 'project hpc config', run: () => {
    if (!hasColumn('projects', 'hpc_config')) db.exec('ALTER TABLE projects ADD COLUMN hpc_config TEXT DEFAULT NULL');
  } },
  { version: 4, name: 'stable task folder name', run: () => {
    if (!hasColumn('tasks', 'folder_name')) db.exec("ALTER TABLE tasks ADD COLUMN folder_name TEXT DEFAULT ''");
    const tasks = db.prepare("SELECT id, name FROM tasks WHERE folder_name IS NULL OR folder_name = ''").all() as { id: string; name: string }[];
    const update = db.prepare('UPDATE tasks SET folder_name = ? WHERE id = ?');
    for (const task of tasks) update.run(sanitizeTaskFolderName(task.name), task.id);
  } },
  { version: 5, name: 'task specs and execution audit', run: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_specs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        title TEXT NOT NULL,
        remote_workdir TEXT NOT NULL,
        command TEXT NOT NULL,
        execution_payload TEXT NOT NULL DEFAULT '',
        dependencies TEXT NOT NULL DEFAULT '[]',
        step_dependencies TEXT NOT NULL DEFAULT '[]',
        input_files TEXT NOT NULL DEFAULT '[]',
        expected_outputs TEXT NOT NULL DEFAULT '[]',
        preconditions TEXT NOT NULL DEFAULT '[]',
        scientific_checks TEXT NOT NULL DEFAULT '[]',
        success_criteria TEXT NOT NULL DEFAULT '[]',
        approval_points TEXT NOT NULL DEFAULT '[]',
        failure_handling TEXT NOT NULL DEFAULT '[]',
        failure_policy TEXT NOT NULL DEFAULT 'stop',
        timeout_seconds INTEGER NOT NULL DEFAULT 30,
        risk_class TEXT NOT NULL DEFAULT 'unclassified',
        approval_required INTEGER NOT NULL DEFAULT 1,
        command_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approval_events (
        id TEXT PRIMARY KEY,
        task_spec_id TEXT NOT NULL REFERENCES task_specs(id) ON DELETE CASCADE,
        decision TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'user',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_runs (
        id TEXT PRIMARY KEY,
        task_spec_id TEXT NOT NULL REFERENCES task_specs(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'executing',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        exit_code INTEGER,
        output_summary TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '[]',
        error_message TEXT NOT NULL DEFAULT '',
        verification_note TEXT NOT NULL DEFAULT '',
        command_hash TEXT NOT NULL DEFAULT '',
        task_spec_snapshot TEXT NOT NULL DEFAULT '{}',
        UNIQUE(task_spec_id, attempt_no)
      );

      CREATE INDEX IF NOT EXISTS idx_task_specs_task_step ON task_specs(task_id, step_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_approval_events_spec ON approval_events(task_spec_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_command_runs_spec ON command_runs(task_spec_id, attempt_no);
    `);
  } },
  { version: 6, name: 'command run task spec snapshot', run: () => {
    if (!hasColumn('command_runs', 'command_hash')) {
      db.exec("ALTER TABLE command_runs ADD COLUMN command_hash TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn('command_runs', 'task_spec_snapshot')) {
      db.exec("ALTER TABLE command_runs ADD COLUMN task_spec_snapshot TEXT NOT NULL DEFAULT '{}'");
    }
  } },
  { version: 7, name: 'scientific task spec contract', run: () => {
    const columns = [
      ['step_dependencies', "TEXT NOT NULL DEFAULT '[]'"],
      ['input_files', "TEXT NOT NULL DEFAULT '[]'"],
      ['preconditions', "TEXT NOT NULL DEFAULT '[]'"],
      ['scientific_checks', "TEXT NOT NULL DEFAULT '[]'"],
      ['approval_points', "TEXT NOT NULL DEFAULT '[]'"],
      ['failure_handling', "TEXT NOT NULL DEFAULT '[]'"],
    ] as const;
    for (const [column, definition] of columns) {
      if (!hasColumn('task_specs', column)) {
        db.exec(`ALTER TABLE task_specs ADD COLUMN ${column} ${definition}`);
      }
    }
  } },
  { version: 8, name: 'lsf scheduler monitoring audit', run: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_jobs (
        id TEXT PRIMARY KEY,
        task_spec_id TEXT NOT NULL REFERENCES task_specs(id) ON DELETE CASCADE,
        scheduler TEXT NOT NULL DEFAULT 'lsf',
        job_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        submitted_at TEXT NOT NULL,
        last_polled_at TEXT,
        next_poll_after TEXT,
        last_log_read_at TEXT,
        next_log_read_after TEXT,
        latest_summary TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        UNIQUE(task_spec_id, job_id)
      );

      CREATE TABLE IF NOT EXISTS scheduler_poll_events (
        id TEXT PRIMARY KEY,
        scheduler_job_id TEXT NOT NULL REFERENCES scheduler_jobs(id) ON DELETE CASCADE,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'executing',
        scheduler_state TEXT NOT NULL DEFAULT '',
        raw_summary TEXT NOT NULL DEFAULT '',
        remote_exit_code INTEGER,
        error_message TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_spec ON scheduler_jobs(task_spec_id, submitted_at);
      CREATE INDEX IF NOT EXISTS idx_scheduler_polls_job ON scheduler_poll_events(scheduler_job_id, started_at);
    `);
  } },
  { version: 9, name: 'bounded scheduler log read audit', run: () => {
    if (!hasColumn('scheduler_jobs', 'last_log_read_at')) {
      db.exec('ALTER TABLE scheduler_jobs ADD COLUMN last_log_read_at TEXT');
    }
    if (!hasColumn('scheduler_jobs', 'next_log_read_after')) {
      db.exec('ALTER TABLE scheduler_jobs ADD COLUMN next_log_read_after TEXT');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_log_events (
        id TEXT PRIMARY KEY,
        scheduler_job_id TEXT NOT NULL REFERENCES scheduler_jobs(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        line_count INTEGER NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'executing',
        output_summary TEXT NOT NULL DEFAULT '',
        remote_exit_code INTEGER,
        error_message TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_scheduler_logs_job ON scheduler_log_events(scheduler_job_id, started_at);
    `);
  } },
  { version: 10, name: 'experience task spec provenance', run: () => {
    if (!hasColumn('experiences', 'source_task_spec_id')) {
      db.exec('ALTER TABLE experiences ADD COLUMN source_task_spec_id TEXT REFERENCES task_specs(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_experiences_task_spec ON experiences(source_task_spec_id, updated_at)');
  } },
  { version: 11, name: 'task spec execution payload snapshot', run: () => {
    if (!hasColumn('task_specs', 'execution_payload')) {
      db.exec("ALTER TABLE task_specs ADD COLUMN execution_payload TEXT NOT NULL DEFAULT ''");
    }
  } },
];

const applyMigration = db.transaction((migration: typeof migrations[number]) => {
  migration.run();
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(migration.version, migration.name, new Date().toISOString());
});

for (const migration of migrations) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
  if (!applied) applyMigration(migration);
}

export interface InterruptedExecutionRecovery {
  command_runs: number;
  task_specs: number;
  scheduler_polls: number;
  scheduler_jobs: number;
  scheduler_logs: number;
}

export function recoverInterruptedExecutionState(
  database: Database.Database = db,
  recoveredAt = new Date().toISOString(),
): InterruptedExecutionRecovery {
  const commandMessage = 'Workbench restarted while this command run was executing. Remote state is unknown; no automatic retry was attempted.';
  const pollMessage = 'Workbench restarted while this scheduler poll was executing. Job state is unknown; no automatic retry was attempted.';
  const logMessage = 'Workbench restarted while this bounded log read was executing. Read state is unknown; no automatic retry was attempted.';

  const recover = database.transaction(() => {
    const commandRuns = database.prepare(`
      SELECT id, task_spec_id FROM command_runs WHERE status = 'executing'
    `).all() as Array<{ id: string; task_spec_id: string }>;
    const polls = database.prepare(`
      SELECT p.id, p.scheduler_job_id, j.task_spec_id
      FROM scheduler_poll_events p
      JOIN scheduler_jobs j ON j.id = p.scheduler_job_id
      WHERE p.status = 'executing'
    `).all() as Array<{ id: string; scheduler_job_id: string; task_spec_id: string }>;
    const logs = database.prepare(`
      SELECT id FROM scheduler_log_events WHERE status = 'executing'
    `).all() as Array<{ id: string }>;

    const updateRun = database.prepare(`
      UPDATE command_runs SET status = 'unknown', finished_at = ?, error_message = ?
      WHERE id = ? AND status = 'executing'
    `);
    for (const run of commandRuns) updateRun.run(recoveredAt, commandMessage, run.id);

    const taskSpecIds = new Set(commandRuns.map(run => run.task_spec_id));
    for (const poll of polls) taskSpecIds.add(poll.task_spec_id);
    const updateTaskSpec = database.prepare(`
      UPDATE task_specs SET status = 'unknown', updated_at = ?
      WHERE id = ? AND status IN ('executing', 'monitoring')
    `);
    let recoveredTaskSpecs = 0;
    for (const taskSpecId of taskSpecIds) {
      recoveredTaskSpecs += updateTaskSpec.run(recoveredAt, taskSpecId).changes;
    }

    const updatePoll = database.prepare(`
      UPDATE scheduler_poll_events SET status = 'unknown', scheduler_state = 'UNKNOWN',
        error_message = ?, finished_at = ?
      WHERE id = ? AND status = 'executing'
    `);
    for (const poll of polls) updatePoll.run(pollMessage, recoveredAt, poll.id);

    const schedulerJobIds = new Set(polls.map(poll => poll.scheduler_job_id));
    const updateSchedulerJob = database.prepare(`
      UPDATE scheduler_jobs SET status = 'UNKNOWN', error_message = ? WHERE id = ?
    `);
    let recoveredSchedulerJobs = 0;
    for (const schedulerJobId of schedulerJobIds) {
      recoveredSchedulerJobs += updateSchedulerJob.run(pollMessage, schedulerJobId).changes;
    }

    const updateLog = database.prepare(`
      UPDATE scheduler_log_events SET status = 'unknown', error_message = ?, finished_at = ?
      WHERE id = ? AND status = 'executing'
    `);
    for (const log of logs) updateLog.run(logMessage, recoveredAt, log.id);

    return {
      command_runs: commandRuns.length,
      task_specs: recoveredTaskSpecs,
      scheduler_polls: polls.length,
      scheduler_jobs: recoveredSchedulerJobs,
      scheduler_logs: logs.length,
    };
  });

  return recover();
}

// Any row still marked executing belongs to an interrupted server lifetime.
// Conservatively finalize it as unknown before accepting new API requests.
recoverInterruptedExecutionState();

export default db;
