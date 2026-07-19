import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import {
  schedulerLogFinishSchema,
  schedulerLogStartSchema,
  schedulerPollFinishSchema,
  validateBody,
} from '../validation.js';

const router = Router();
const MIN_POLL_INTERVAL_MS = 60_000;

interface SchedulerJobRow {
  id: string;
  task_spec_id: string;
  scheduler: string;
  job_id: string;
  status: string;
  submitted_at: string;
  last_polled_at: string | null;
  next_poll_after: string | null;
  last_log_read_at: string | null;
  next_log_read_after: string | null;
  latest_summary: string;
  error_message: string;
}

interface SchedulerPollRow {
  id: string;
  scheduler_job_id: string;
  command: string;
  status: string;
  scheduler_state: string;
  raw_summary: string;
  remote_exit_code: number | null;
  error_message: string;
  started_at: string;
  finished_at: string | null;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSchedulerJob(id: string): SchedulerJobRow {
  const row = db.prepare('SELECT * FROM scheduler_jobs WHERE id = ?').get(id) as SchedulerJobRow | undefined;
  if (!row) throw new HttpError(404, 'Scheduler job not found');
  return row;
}

function serializeJob(row: SchedulerJobRow) {
  const polls = db.prepare(`
    SELECT * FROM scheduler_poll_events WHERE scheduler_job_id = ? ORDER BY started_at ASC
  `).all(row.id);
  const logReads = db.prepare(`
    SELECT * FROM scheduler_log_events WHERE scheduler_job_id = ? ORDER BY started_at ASC
  `).all(row.id);
  return { ...row, polls, log_reads: logReads };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

router.get('/:jobRecordId', (req, res) => {
  res.json(serializeJob(getSchedulerJob(String(req.params.jobRecordId))));
});

router.post('/:jobRecordId/polls', (req, res) => {
  const job = getSchedulerJob(String(req.params.jobRecordId));
  const spec = db.prepare('SELECT status, remote_workdir FROM task_specs WHERE id = ?')
    .get(job.task_spec_id) as { status: string; remote_workdir: string } | undefined;
  if (!spec) throw new HttpError(404, 'Task Spec not found');
  if (spec.status !== 'monitoring') {
    throw new HttpError(409, `Scheduler polling is stopped because the Task Spec is ${spec.status}`);
  }
  const activePoll = db.prepare(`
    SELECT id FROM scheduler_poll_events WHERE scheduler_job_id = ? AND status = 'executing'
  `).get(job.id);
  if (activePoll) throw new HttpError(409, 'A scheduler poll is already executing');

  const nowMs = Date.now();
  const nextAllowedMs = job.next_poll_after ? Date.parse(job.next_poll_after) : 0;
  if (Number.isFinite(nextAllowedMs) && nextAllowedMs > nowMs) {
    const remainingSeconds = Math.ceil((nextAllowedMs - nowMs) / 1000);
    throw new HttpError(429, `Scheduler polling is limited to once every 60 seconds; retry after ${remainingSeconds} seconds`);
  }

  const pollId = makeId('poll');
  const now = new Date(nowMs).toISOString();
  const nextPollAfter = new Date(nowMs + MIN_POLL_INTERVAL_MS).toISOString();
  const command = `bjobs -noheader -o stat ${job.job_id}`;
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO scheduler_poll_events (id, scheduler_job_id, command, status, started_at)
      VALUES (?, ?, ?, 'executing', ?)
    `).run(pollId, job.id, command, now);
    db.prepare('UPDATE scheduler_jobs SET last_polled_at = ?, next_poll_after = ? WHERE id = ?')
      .run(now, nextPollAfter, job.id);
  });
  transaction();
  const poll = db.prepare('SELECT * FROM scheduler_poll_events WHERE id = ?').get(pollId);
  res.status(201).json({
    job: serializeJob(getSchedulerJob(job.id)),
    poll: { ...(poll as Record<string, unknown>), remote_workdir: spec.remote_workdir },
  });
});

router.put('/polls/:pollId', validateBody(schedulerPollFinishSchema), (req, res) => {
  const poll = db.prepare('SELECT * FROM scheduler_poll_events WHERE id = ?')
    .get(String(req.params.pollId)) as SchedulerPollRow | undefined;
  if (!poll) throw new HttpError(404, 'Scheduler poll not found');
  if (poll.status !== 'executing') throw new HttpError(409, 'Scheduler poll is already finalized');
  if (req.body.bridge_status === 'completed' && req.body.remote_exit_code !== 0) {
    throw new HttpError(400, 'A completed scheduler query must report remote_exit_code 0');
  }
  if (req.body.bridge_status === 'completed' && !req.body.scheduler_state) {
    throw new HttpError(400, 'A completed scheduler query must report a recognized scheduler state');
  }

  const job = getSchedulerJob(poll.scheduler_job_id);
  const schedulerState = req.body.scheduler_state ?? 'UNKNOWN';
  let specStatus = 'monitoring';
  if (req.body.bridge_status !== 'completed' || schedulerState === 'UNKWN') specStatus = 'unknown';
  else if (schedulerState === 'DONE') specStatus = 'verifying';
  else if (schedulerState === 'EXIT' || schedulerState === 'ZOMBI') specStatus = 'failed';

  const now = new Date().toISOString();
  const pollStatus = req.body.bridge_status;
  const errorMessage = req.body.error_message ?? '';
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE scheduler_poll_events SET status = ?, scheduler_state = ?, raw_summary = ?,
        remote_exit_code = ?, error_message = ?, finished_at = ? WHERE id = ?
    `).run(
      pollStatus,
      schedulerState,
      req.body.raw_summary ?? '',
      req.body.remote_exit_code ?? null,
      errorMessage,
      now,
      poll.id,
    );
    db.prepare(`
      UPDATE scheduler_jobs SET status = ?, latest_summary = ?, error_message = ? WHERE id = ?
    `).run(schedulerState, req.body.raw_summary ?? '', errorMessage, job.id);
    db.prepare('UPDATE task_specs SET status = ?, updated_at = ? WHERE id = ?')
      .run(specStatus, now, job.task_spec_id);
  });
  transaction();

  res.json({
    job: serializeJob(getSchedulerJob(job.id)),
    task_spec_status: specStatus,
  });
});

router.post('/:jobRecordId/log-reads', validateBody(schedulerLogStartSchema), (req, res) => {
  const job = getSchedulerJob(String(req.params.jobRecordId));
  const activeRead = db.prepare(`
    SELECT id FROM scheduler_log_events WHERE scheduler_job_id = ? AND status = 'executing'
  `).get(job.id);
  if (activeRead) throw new HttpError(409, 'A bounded log read is already executing');

  const nowMs = Date.now();
  const nextAllowedMs = job.next_log_read_after ? Date.parse(job.next_log_read_after) : 0;
  if (Number.isFinite(nextAllowedMs) && nextAllowedMs > nowMs) {
    const remainingSeconds = Math.ceil((nextAllowedMs - nowMs) / 1000);
    throw new HttpError(429, `Bounded log reads are limited to once every 60 seconds; retry after ${remainingSeconds} seconds`);
  }

  const spec = db.prepare('SELECT remote_workdir FROM task_specs WHERE id = ?')
    .get(job.task_spec_id) as { remote_workdir: string } | undefined;
  if (!spec) throw new HttpError(404, 'Task Spec not found');
  const eventId = makeId('logread');
  const now = new Date(nowMs).toISOString();
  const nextLogReadAfter = new Date(nowMs + MIN_POLL_INTERVAL_MS).toISOString();
  const relativePath = String(req.body.relative_path).replace(/\\/g, '/');
  const lines = Number(req.body.lines);
  const bridgeCommand = `tail -n ${lines} -- ${shellQuote(relativePath)}`;
  const command = `cd -- ${shellQuote(spec.remote_workdir)} && ${bridgeCommand}`;
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO scheduler_log_events (
        id, scheduler_job_id, relative_path, line_count, command, status, started_at
      ) VALUES (?, ?, ?, ?, ?, 'executing', ?)
    `).run(eventId, job.id, relativePath, lines, command, now);
    db.prepare('UPDATE scheduler_jobs SET last_log_read_at = ?, next_log_read_after = ? WHERE id = ?')
      .run(now, nextLogReadAfter, job.id);
  });
  transaction();
  const logRead = db.prepare('SELECT * FROM scheduler_log_events WHERE id = ?').get(eventId) as Record<string, unknown>;
  res.status(201).json({
    job: serializeJob(getSchedulerJob(job.id)),
    log_read: { ...logRead, bridge_command: bridgeCommand, remote_workdir: spec.remote_workdir },
  });
});

router.put('/log-reads/:logReadId', validateBody(schedulerLogFinishSchema), (req, res) => {
  const logRead = db.prepare('SELECT * FROM scheduler_log_events WHERE id = ?')
    .get(String(req.params.logReadId)) as { id: string; scheduler_job_id: string; status: string } | undefined;
  if (!logRead) throw new HttpError(404, 'Bounded log read not found');
  if (logRead.status !== 'executing') throw new HttpError(409, 'Bounded log read is already finalized');
  if (req.body.bridge_status === 'completed' && req.body.remote_exit_code !== 0) {
    throw new HttpError(400, 'A completed bounded log read must report remote_exit_code 0');
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE scheduler_log_events SET status = ?, output_summary = ?, remote_exit_code = ?,
      error_message = ?, finished_at = ? WHERE id = ?
  `).run(
    req.body.bridge_status,
    req.body.output_summary ?? '',
    req.body.remote_exit_code ?? null,
    req.body.error_message ?? '',
    now,
    logRead.id,
  );
  res.json({ job: serializeJob(getSchedulerJob(logRead.scheduler_job_id)) });
});

export default router;
