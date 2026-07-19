import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type BetterSqlite3 from 'better-sqlite3';

let app: Express;
let db: BetterSqlite3.Database;
let tempRoot: string;
let workingDir: string;

beforeAll(async () => {
  // Keep the fixture under the repository so sandboxed runners can realpath
  // every ancestor without weakening production path-safety checks.
  tempRoot = fs.mkdtempSync(path.join(process.cwd(), '.dft-dmft-test-'));
  workingDir = path.join(tempRoot, 'working');
  fs.mkdirSync(workingDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'legacy.db');

  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      material TEXT DEFAULT '',
      working_dir TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      workflow_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('proj-old', 'Legacy project', '', 'V2O3', workingDir, now, now);
  legacy.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('task-old', 'proj-old', 'Legacy Task', '', 'dft-dmft-oneshot', 'active', now, now);
  legacy.close();

  process.env.DFT_DMFT_DB_PATH = dbPath;
  const dbModule = await import('./db.js');
  db = dbModule.default;
  const appModule = await import('./app.js');
  app = appModule.createApp();
});

afterAll(() => {
  db.close();
  delete process.env.DFT_DMFT_DB_PATH;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('stability foundations', () => {
  it('migrates legacy rows and keeps the task folder stable after rename', async () => {
    const before = await request(app).get('/api/tasks/task-old').expect(200);
    expect(before.body.folder_name).toBe('Legacy Task');

    const renamed = await request(app)
      .put('/api/tasks/task-old')
      .send({ name: 'Renamed display title' })
      .expect(200);
    expect(renamed.body.name).toBe('Renamed display title');
    expect(renamed.body.folder_name).toBe('Legacy Task');

    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
    expect(versions.map(item => item.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('validates workflows, creates stable stage folders and rejects collisions', async () => {
    await request(app)
      .post('/api/projects/proj-old/tasks')
      .send({ name: 'Invalid workflow', workflow_id: 'missing' })
      .expect(400);

    const created = await request(app)
      .post('/api/projects/proj-old/tasks')
      .send({ name: 'Run 01', workflow_id: 'dft-dmft-oneshot' });

    expect(created.status, JSON.stringify(created.body)).toBe(201);

    expect(created.body.folder_name).toBe('Run 01');
    for (const stage of ['prep', 'dft', 'wannier', 'dmft', 'check']) {
      expect(fs.statSync(path.join(workingDir, 'Run 01', stage)).isDirectory()).toBe(true);
    }

    await request(app)
      .post('/api/projects/proj-old/tasks')
      .send({ name: 'Run 01', workflow_id: 'dft-dmft-oneshot' })
      .expect(409);
  });

  it('rejects invalid status, unknown steps and traversal attempts', async () => {
    await request(app)
      .put('/api/tasks/task-old/progress/dft-02')
      .send({ status: 'not-a-status' })
      .expect(400);

    await request(app)
      .put('/api/tasks/task-old/progress/not-a-step')
      .send({ status: 'completed' })
      .expect(400);

    await request(app)
      .put('/api/tasks/task-old/progress/dft-02')
      .send({ status: 'completed' })
      .expect(200);

    await request(app)
      .get('/api/projects/proj-old/files')
      .query({ path: '../outside' })
      .expect(400);
  });

  it('returns JSON for unknown API endpoints', async () => {
    const response = await request(app).get('/api/not-real').expect(404);
    expect(response.body).toEqual({ error: 'API endpoint not found' });
  });

  it('keeps Task Specs, approvals and command runs auditable', async () => {
    const hpcConfig = {
      host: '',
      user: '',
      remotePath: '/home/bnu001/dft-dmft',
      moduleQE: 'qe/7.2',
      moduleWannier: 'wannier90/3.1',
      moduleTRIQS: 'triqs/3.3',
      nprocs: '16',
      connectionMode: 'web-terminal',
      portalWindowTitle: 'HPCPlus平台',
    };
    await request(app)
      .put('/api/projects/proj-old')
      .send({ hpc_config: JSON.stringify(hpcConfig) })
      .expect(200);

    const created = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({
        step_id: 'dft-02',
        title: '检查远端目录',
        command: 'pwd; hostname',
        expected_outputs: ['显示当前目录和节点名'],
        success_criteria: ['退出码为 0'],
      })
      .expect(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.remote_workdir).toBe('/home/bnu001/dft-dmft/Legacy Task/dft');
    expect(created.body.step_dependencies).toEqual(['prep-03']);
    expect(created.body.input_files).toContain('scf.in');
    expect(created.body.scientific_checks.length).toBeGreaterThan(0);
    expect(created.body.approval_points.length).toBeGreaterThan(0);

    const chineseTask = await request(app)
      .post('/api/projects/proj-old/tasks')
      .send({ name: '钒氧化物 01', workflow_id: 'dft-dmft-oneshot' })
      .expect(201);
    const chineseTaskSpec = await request(app)
      .post(`/api/tasks/${chineseTask.body.id}/task-specs`)
      .send({ step_id: 'dft-02', title: '检查中文任务目录', command: 'pwd' })
      .expect(201);
    expect(chineseTaskSpec.body.remote_workdir).toBe('/home/bnu001/dft-dmft/钒氧化物 01/dft');

    await request(app)
      .post(`/api/task-specs/${created.body.id}/check`)
      .send({})
      .expect(409);
    await request(app)
      .put('/api/tasks/task-old/progress/prep-03')
      .send({ status: 'completed' })
      .expect(200);
    const checkedForApproval = await request(app)
      .post(`/api/task-specs/${created.body.id}/check`)
      .send({})
      .expect(200);
    expect(checkedForApproval.body.risk_class).toBe('read-only');
    expect(checkedForApproval.body.status).toBe('awaiting_approval');
    const checked = await request(app)
      .post(`/api/task-specs/${created.body.id}/approvals`)
      .send({ decision: 'approved', actor: 'user', note: '科学输入和检查点已确认' })
      .expect(201);
    expect(checked.body.risk_class).toBe('read-only');
    expect(checked.body.status).toBe('ready');
    expect(checked.body.command_hash).toMatch(/^[a-f0-9]{64}$/);

    const executing = await request(app)
      .post(`/api/task-specs/${created.body.id}/runs`)
      .send({})
      .expect(201);
    expect(executing.body.status).toBe('executing');
    const runId = executing.body.runs[0].id as string;
    expect(executing.body.runs[0].command_hash).toBe(checked.body.command_hash);
    expect(executing.body.runs[0].task_spec_snapshot.command).toBe('pwd; hostname');
    expect(executing.body.runs[0].task_spec_snapshot.scientific_checks.length).toBeGreaterThan(0);

    const verifying = await request(app)
      .put(`/api/task-specs/runs/${runId}`)
      .send({ status: 'completed', exit_code: 0, output_summary: '/home/bnu001/dft-dmft/Legacy Task/dft' })
      .expect(200);
    expect(verifying.body.status).toBe('verifying');

    const completed = await request(app)
      .post(`/api/task-specs/${created.body.id}/verify`)
      .send({
        decision: 'completed',
        note: '目录与任务一致',
        evidence: [{ kind: 'terminal-output', summary: 'pwd 与预期目录一致' }],
      })
      .expect(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.runs[0].verification_note).toBe('目录与任务一致');
    await request(app)
      .post('/api/experiences')
      .send({ title: '无效来源', content: '不应创建', source_task_spec_id: 'spec-missing' })
      .expect(400);
    const experience = await request(app)
      .post('/api/experiences')
      .send({
        title: '目录检查经验',
        content: '确认执行目录必须与任务阶段目录一致。',
        tags: ['HPCPlus', '审计'],
        source_task_spec_id: created.body.id,
      })
      .expect(201);
    expect(experience.body.related_project_id).toBe('proj-old');
    expect(experience.body.related_task_id).toBe('task-old');
    expect(experience.body.related_step_id).toBe('dft-02');
    expect(experience.body.source_task_spec_id).toBe(created.body.id);
    const specWithExperience = await request(app)
      .get(`/api/task-specs/${created.body.id}`)
      .expect(200);
    expect(specWithExperience.body.experiences[0].title).toBe('目录检查经验');

    const monitoredSubmit = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({
        step_id: 'dft-02',
        title: '受控提交与监控',
        command: 'bsub < scf.lsf',
        execution_payload: "#BSUB -J scf\ncd -- '/home/bnu001/dft-dmft/Legacy Task/dft'\nrm -f stale.out\npw.x < scf.in > scf.out",
        step_dependencies: [],
        approval_points: ['确认资源、目录与科学输入'],
      })
      .expect(201);
    const monitoredAwaiting = await request(app)
      .post(`/api/task-specs/${monitoredSubmit.body.id}/check`)
      .send({})
      .expect(200);
    expect(monitoredAwaiting.body.status).toBe('awaiting_approval');
    expect(monitoredAwaiting.body.risk_class).toBe('submit+mutating');
    await request(app)
      .post(`/api/task-specs/${monitoredSubmit.body.id}/approvals`)
      .send({ decision: 'approved', actor: 'user', note: '完整提交动作已确认' })
      .expect(201);
    const submitting = await request(app)
      .post(`/api/task-specs/${monitoredSubmit.body.id}/runs`)
      .send({})
      .expect(201);
    const submitRunId = submitting.body.runs[0].id as string;
    expect(submitting.body.runs[0].task_spec_snapshot.execution_payload).toContain('rm -f stale.out');
    await request(app)
      .put(`/api/task-specs/runs/${submitRunId}`)
      .send({ status: 'completed', exit_code: 0, output_summary: 'Job <12345> is submitted.' })
      .expect(400);
    const monitoring = await request(app)
      .put(`/api/task-specs/runs/${submitRunId}`)
      .send({
        status: 'completed',
        exit_code: 0,
        output_summary: 'Job <12345> is submitted.',
        scheduler_job: { scheduler: 'lsf', job_id: '12345' },
      })
      .expect(200);
    expect(monitoring.body.status).toBe('monitoring');
    expect(monitoring.body.scheduler_jobs[0].job_id).toBe('12345');
    const schedulerJobRecordId = monitoring.body.scheduler_jobs[0].id as string;

    const firstPoll = await request(app)
      .post(`/api/scheduler-jobs/${schedulerJobRecordId}/polls`)
      .send({})
      .expect(201);
    expect(firstPoll.body.poll.command).toBe('bjobs -noheader -o stat 12345');
    expect(firstPoll.body.poll.remote_workdir).toBe('/home/bnu001/dft-dmft/Legacy Task/dft');
    await request(app).post(`/api/scheduler-jobs/${schedulerJobRecordId}/polls`).send({}).expect(409);
    const running = await request(app)
      .put(`/api/scheduler-jobs/polls/${firstPoll.body.poll.id}`)
      .send({ bridge_status: 'completed', scheduler_state: 'RUN', remote_exit_code: 0, raw_summary: 'RUN' })
      .expect(200);
    expect(running.body.task_spec_status).toBe('monitoring');
    await request(app).post(`/api/scheduler-jobs/${schedulerJobRecordId}/polls`).send({}).expect(429);

    await request(app)
      .post(`/api/scheduler-jobs/${schedulerJobRecordId}/log-reads`)
      .send({ relative_path: '../outside.log', lines: 80 })
      .expect(400);
    const logRead = await request(app)
      .post(`/api/scheduler-jobs/${schedulerJobRecordId}/log-reads`)
      .send({ relative_path: 'scf.out', lines: 80 })
      .expect(201);
    expect(logRead.body.log_read.command).toBe("cd -- '/home/bnu001/dft-dmft/Legacy Task/dft' && tail -n 80 -- 'scf.out'");
    expect(logRead.body.log_read.bridge_command).toBe("tail -n 80 -- 'scf.out'");
    expect(logRead.body.log_read.remote_workdir).toBe('/home/bnu001/dft-dmft/Legacy Task/dft');
    await request(app)
      .post(`/api/scheduler-jobs/${schedulerJobRecordId}/log-reads`)
      .send({ relative_path: 'scf.out', lines: 80 })
      .expect(409);
    const logFinished = await request(app)
      .put(`/api/scheduler-jobs/log-reads/${logRead.body.log_read.id}`)
      .send({ bridge_status: 'completed', remote_exit_code: 0, output_summary: 'JOB DONE' })
      .expect(200);
    expect(logFinished.body.job.log_reads[0].output_summary).toBe('JOB DONE');
    await request(app)
      .post(`/api/scheduler-jobs/${schedulerJobRecordId}/log-reads`)
      .send({ relative_path: 'scf.out', lines: 80 })
      .expect(429);

    db.prepare('UPDATE scheduler_jobs SET next_poll_after = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), schedulerJobRecordId);
    const secondPoll = await request(app)
      .post(`/api/scheduler-jobs/${schedulerJobRecordId}/polls`)
      .send({})
      .expect(201);
    const schedulerDone = await request(app)
      .put(`/api/scheduler-jobs/polls/${secondPoll.body.poll.id}`)
      .send({ bridge_status: 'completed', scheduler_state: 'DONE', remote_exit_code: 0, raw_summary: 'DONE' })
      .expect(200);
    expect(schedulerDone.body.task_spec_status).toBe('verifying');
    const verifiedJob = await request(app)
      .post(`/api/task-specs/${monitoredSubmit.body.id}/verify`)
      .send({
        decision: 'completed',
        note: '调度完成且科学输出已核验',
        evidence: [{ kind: 'manual-verification', summary: '预期输出文件和收敛判据均已人工检查' }],
      })
      .expect(200);
    expect(verifiedJob.body.status).toBe('completed');
    expect(verifiedJob.body.scheduler_jobs[0].polls).toHaveLength(2);
    expect(verifiedJob.body.scheduler_jobs[0].log_reads).toHaveLength(1);

    const submitSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({ step_id: 'dft-02', title: '提交 SCF', command: 'bsub < scf.lsf' })
      .expect(201);
    const awaiting = await request(app)
      .post(`/api/task-specs/${submitSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(awaiting.body.status).toBe('awaiting_approval');
    await request(app).post(`/api/task-specs/${submitSpec.body.id}/runs`).send({}).expect(409);

    const approved = await request(app)
      .post(`/api/task-specs/${submitSpec.body.id}/approvals`)
      .send({ decision: 'approved', actor: 'user', note: '资源与目录已确认' })
      .expect(201);
    expect(approved.body.status).toBe('ready');
    expect(approved.body.approvals).toHaveLength(1);

    const edited = await request(app)
      .put(`/api/task-specs/${submitSpec.body.id}`)
      .send({ command: 'bsub < scf-revised.lsf' })
      .expect(200);
    expect(edited.body.status).toBe('draft');
    expect(edited.body.command_hash).toBe('');
    expect(edited.body.approvals).toHaveLength(1);

    const unknownSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({
        step_id: 'dft-02',
        title: '状态未知检查',
        command: 'bjobs 12345',
        step_dependencies: [],
        approval_points: [],
      })
      .expect(201);
    const unknownReady = await request(app)
      .post(`/api/task-specs/${unknownSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(unknownReady.body.status).toBe('ready');
    const unknownExecuting = await request(app)
      .post(`/api/task-specs/${unknownSpec.body.id}/runs`)
      .send({})
      .expect(201);
    const unknownRunId = unknownExecuting.body.runs[0].id as string;
    const unknown = await request(app)
      .put(`/api/task-specs/runs/${unknownRunId}`)
      .send({ status: 'unknown', error_message: '网页终端在等待标记时超时' })
      .expect(200);
    expect(unknown.body.status).toBe('unknown');
    expect(unknown.body.runs[0].status).toBe('unknown');
    const revisedUnknown = await request(app)
      .put(`/api/task-specs/${unknownSpec.body.id}`)
      .send({ command: 'bjobs 12346' })
      .expect(200);
    expect(revisedUnknown.body.status).toBe('draft');
    expect(revisedUnknown.body.runs[0].task_spec_snapshot.command).toBe('bjobs 12345');
    await request(app).post(`/api/task-specs/${unknownSpec.body.id}/runs`).send({}).expect(409);

    await request(app)
      .put(`/api/task-specs/${created.body.id}`)
      .send({ command: 'pwd' })
      .expect(409);

    await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({
        step_id: 'dft-02',
        title: '越界目录',
        command: 'pwd',
        remote_workdir: '/home/bnu001/other-task',
      })
      .expect(403);

    const blockedSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({ step_id: 'dft-02', title: '禁止下载', command: 'curl https://example.com/input' })
      .expect(201);
    const blocked = await request(app)
      .post(`/api/task-specs/${blockedSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(blocked.body.status).toBe('blocked');
    expect(blocked.body.blocked_reasons).toContain('network or file-transfer command');

    const blockedPayloadSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({
        step_id: 'dft-02',
        title: '载荷中禁止下载',
        command: 'bsub < unsafe.lsf',
        execution_payload: '#!/bin/bash\ncurl https://example.com/input',
        step_dependencies: [],
      })
      .expect(201);
    const blockedPayload = await request(app)
      .post(`/api/task-specs/${blockedPayloadSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(blockedPayload.body.status).toBe('blocked');
    expect(blockedPayload.body.blocked_reasons).toContain('network or file-transfer command');

    const directoryEscapeSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({ step_id: 'dft-02', title: '禁止切换目录', command: 'cd ../other-task; pwd' })
      .expect(201);
    const directoryEscape = await request(app)
      .post(`/api/task-specs/${directoryEscapeSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(directoryEscape.body.status).toBe('blocked');
    expect(directoryEscape.body.blocked_reasons).toContain('directory change or parent traversal');

    const absolutePathSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({ step_id: 'dft-02', title: '禁止绝对路径', command: 'cat /etc/passwd' })
      .expect(201);
    const absolutePath = await request(app)
      .post(`/api/task-specs/${absolutePathSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(absolutePath.body.status).toBe('blocked');
    expect(absolutePath.body.blocked_reasons).toContain('absolute or home-relative path');

    const broadScanSpec = await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({ step_id: 'dft-02', title: '禁止递归扫描', command: 'find . -type f' })
      .expect(201);
    const broadScan = await request(app)
      .post(`/api/task-specs/${broadScanSpec.body.id}/check`)
      .send({})
      .expect(200);
    expect(broadScan.body.status).toBe('blocked');
    expect(broadScan.body.blocked_reasons).toContain('broad filesystem scan');

    await request(app)
      .post('/api/tasks/task-old/task-specs')
      .send({ step_id: 'dft-02', title: '超长命令', command: 'x'.repeat(8193) })
      .expect(400);
  });
});
