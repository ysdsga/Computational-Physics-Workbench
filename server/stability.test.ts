import fs from 'fs';
import os from 'os';
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dft-dmft-stability-'));
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
    expect(versions.map(item => item.version)).toEqual([1, 2, 3, 4]);
  });

  it('validates workflows, creates stable stage folders and rejects collisions', async () => {
    await request(app)
      .post('/api/projects/proj-old/tasks')
      .send({ name: 'Invalid workflow', workflow_id: 'missing' })
      .expect(400);

    const created = await request(app)
      .post('/api/projects/proj-old/tasks')
      .send({ name: 'Run 01', workflow_id: 'dft-dmft-oneshot' })
      .expect(201);

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
});

