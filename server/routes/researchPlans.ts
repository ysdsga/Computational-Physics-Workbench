import { Router, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { resolveWithinRoot } from '../services/pathSafety.js';

const router = Router();

interface PlanRow {
  id: string;
  file_name: string;
  title: string;
  project_id: string | null;
  linked_task_ids: string;
  status: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

/**
 * Resolve a plan file to its owning project's working directory.
 */
function getProjectDir(projectId: unknown): string {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new PlanDirectoryError(400, 'project_id is required');
  }
  const proj = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as
    | { working_dir: string | null }
    | undefined;
  if (!proj) throw new PlanDirectoryError(404, 'Project not found');
  if (!proj.working_dir?.trim()) {
    throw new PlanDirectoryError(400, 'Project has no working directory configured');
  }
  const dir = path.resolve(proj.working_dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new PlanDirectoryError(400, 'Project working directory does not exist');
  }
  return dir;
}

class PlanDirectoryError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function resolveProjectDir(res: Response, projectId: unknown): string | null {
  try {
    return getProjectDir(projectId);
  } catch (err) {
    if (err instanceof PlanDirectoryError) {
      res.status(err.status).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

/** Resolve file_name relative to a base dir, blocking path escapes. */
function safeResolve(baseDir: string, fileName: string): string | null {
  try { return resolveWithinRoot(baseDir, fileName, { allowRoot: false, label: 'research plan path' }); }
  catch { return null; }
}

/** Sanitize title → safe .md file name */
function titleToFileName(title: string, baseDir: string): string {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'untitled';
  let name = `${base}.md`;
  if (fs.existsSync(path.join(baseDir, name))) {
    name = `${base}_${Date.now()}.md`;
  }
  return name;
}

function fileNameToTitle(fileName: string): string {
  return fileName.replace(/\.md$/i, '').replace(/_/g, ' ');
}

const now = () => new Date().toISOString();
const newId = () => `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sha256 = (content: string) => crypto.createHash('sha256').update(content, 'utf8').digest('hex');

/**
 * Scan a plan's base dir for *.md and auto-insert metadata rows
 * for files that don't have a DB record yet.
 */
function syncFilesWithDb(projectId: string): void {
  let dir: string;
  try {
    dir = getProjectDir(projectId);
  } catch {
    return;
  }
  if (!fs.existsSync(dir)) return;
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  } catch {
    return;
  }
  const ts = now();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO research_plans
       (id, file_name, title, project_id, linked_task_ids, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', 'draft', '[]', ?, ?)`,
  );
  for (const f of files) {
    // Only auto-insert if no existing row with same file_name AND project_id
    const existing = db.prepare(
      'SELECT id FROM research_plans WHERE file_name = ? AND project_id = ?',
    ).get(f, projectId);
    if (!existing) {
      insert.run(newId(), f, fileNameToTitle(f), projectId, ts, ts);
    }
  }
}

// ===== LIST =====
router.get('/', (req, res) => {
  let query = 'SELECT rp.* FROM research_plans rp JOIN projects p ON p.id = rp.project_id';
  const params: string[] = [];
  const conds: string[] = [];
  const { projectId, taskId, status, search } = req.query;

  // Sync only project working directories. The retired root-level
  // research-plans/ directory is intentionally ignored.
  if (projectId) {
    syncFilesWithDb(projectId as string);
  } else {
    const allProjs = db.prepare(
      "SELECT id FROM projects WHERE TRIM(COALESCE(working_dir, '')) <> ''",
    ).all() as
      | { id: string }[]
      | [];
    allProjs.forEach(p => syncFilesWithDb(p.id));
  }
  if (taskId) {
    conds.push('EXISTS (SELECT 1 FROM json_each(rp.linked_task_ids) WHERE json_each.value = ?)');
    params.push(taskId as string);
  }

  if (projectId) {
    conds.push('rp.project_id = ?');
    params.push(projectId as string);
  }
  if (status) {
    conds.push('rp.status = ?');
    params.push(status as string);
  }
  if (search) {
    conds.push('(rp.title LIKE ? OR rp.tags LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY rp.updated_at DESC';

  const rows = db.prepare(query).all(...params) as PlanRow[];

  // Annotate with missing flag
  const annotated = rows.map(r => {
    try {
      const dir = getProjectDir(r.project_id);
      const full = safeResolve(dir, r.file_name);
      const exists = full ? fs.existsSync(full) : false;
      return { ...r, missing: !exists };
    } catch (err) {
      if (err instanceof PlanDirectoryError) {
        return { ...r, missing: true };
      }
      throw err;
    }
  });
  res.json(annotated);
});

// ===== IMPORT (must come before /:id) =====
router.post('/import', (req, res) => {
  const { sourcePath, fileName, content, project_id } = req.body || {};
  if (!sourcePath && content === undefined) {
    return res.status(400).json({ error: 'Provide either sourcePath or content' });
  }

  const pid = typeof project_id === 'string' ? project_id.trim() : '';
  const dir = resolveProjectDir(res, pid);
  if (!dir) return;

  let targetName: string;
  try {
    if (sourcePath) {
      if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({ error: `Source not found: ${sourcePath}` });
      }
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) return res.status(400).json({ error: 'sourcePath is not a file' });
      if (stat.size > 10 * 1024 * 1024) return res.status(413).json({ error: 'Source too large (max 10MB)' });
      targetName = fileName || path.basename(sourcePath);
      if (!targetName.toLowerCase().endsWith('.md')) targetName += '.md';
      const safe = safeResolve(dir, targetName);
      if (!safe) return res.status(400).json({ error: 'Invalid fileName' });
      if (fs.existsSync(safe)) {
        const base = targetName.replace(/\.md$/i, '');
        targetName = `${base}_${Date.now()}.md`;
      }
      fs.copyFileSync(sourcePath, path.join(dir, targetName));
    } else {
      targetName = fileName ? String(fileName) : `imported_${Date.now()}.md`;
      if (!targetName.toLowerCase().endsWith('.md')) targetName += '.md';
      const safe = safeResolve(dir, targetName);
      if (!safe) return res.status(400).json({ error: 'Invalid fileName' });
      if (fs.existsSync(safe)) {
        const base = targetName.replace(/\.md$/i, '');
        targetName = `${base}_${Date.now()}.md`;
      }
      fs.writeFileSync(path.join(dir, targetName), String(content), 'utf-8');
    }
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }

  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO research_plans (id, file_name, title, project_id, linked_task_ids, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', 'draft', '[]', ?, ?)`,
  ).run(id, targetName, fileNameToTitle(targetName), pid, ts, ts);
  const row = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(id) as PlanRow;
  res.status(201).json(row);
});

// ===== CREATE =====
router.post('/', (req, res) => {
  const { title, content, project_id, status, tags, linked_task_ids } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const t = String(title).trim();
  const pid = typeof project_id === 'string' ? project_id.trim() : '';
  const dir = resolveProjectDir(res, pid);
  if (!dir) return;
  const fileName = titleToFileName(t, dir);
  const safe = safeResolve(dir, fileName);
  if (!safe) return res.status(400).json({ error: 'Invalid derived fileName' });

  try {
    fs.writeFileSync(safe, content !== undefined ? String(content) : `# ${t}\n\n`, 'utf-8');
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }

  const id = newId();
  const ts = now();
  const st = status || 'draft';
  const tg = JSON.stringify(Array.isArray(tags) ? tags : []);
  const links = JSON.stringify(Array.isArray(linked_task_ids) ? linked_task_ids : []);
  db.prepare(
    `INSERT INTO research_plans (id, file_name, title, project_id, linked_task_ids, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, fileName, t, pid, links, st, tg, ts, ts);

  const row = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(id) as PlanRow;
  res.status(201).json(row);
});

// ===== GET ONE =====
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(req.params.id) as PlanRow | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  const dir = resolveProjectDir(res, row.project_id);
  if (!dir) return;
  const full = safeResolve(dir, row.file_name);
  const exists = full ? fs.existsSync(full) : false;
  res.json({ ...row, missing: !exists });
});

// ===== GET CONTENT =====
router.get('/:id/content', (req, res) => {
  const row = db.prepare('SELECT file_name, project_id FROM research_plans WHERE id = ?').get(req.params.id) as
    | { file_name: string; project_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  const dir = resolveProjectDir(res, row.project_id);
  if (!dir) return;
  const full = safeResolve(dir, row.file_name);
  if (!full) return res.status(400).json({ error: 'Invalid stored file name' });
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: `File missing on disk: ${row.file_name}` });
  }
  try {
    const stat = fs.statSync(full);
    if (stat.size > 10 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 10MB)' });
    const content = fs.readFileSync(full, 'utf-8');
    res.json({ content, size: stat.size, modified: stat.mtime.toISOString(), sha256: sha256(content) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ===== PUT CONTENT =====
router.put('/:id/content', (req, res) => {
  const { content, expectedSha256 } = req.body || {};
  if (content === undefined) return res.status(400).json({ error: 'content is required' });
  const row = db.prepare('SELECT file_name, project_id FROM research_plans WHERE id = ?').get(req.params.id) as
    | { file_name: string; project_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  const dir = resolveProjectDir(res, row.project_id);
  if (!dir) return;
  const full = safeResolve(dir, row.file_name);
  if (!full) return res.status(400).json({ error: 'Invalid stored file name' });
  try {
    if (!fs.existsSync(full)) return res.status(404).json({ error: `File missing on disk: ${row.file_name}` });
    const currentContent = fs.readFileSync(full, 'utf8');
    const currentSha256 = sha256(currentContent);
    if (expectedSha256 && expectedSha256 !== currentSha256) {
      return res.status(409).json({ error: 'Research plan changed since it was read', code: 'STALE_PLAN', details: { expectedSha256, currentSha256 } });
    }
    const nextContent = String(content);
    const temp = `${full}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, nextContent, 'utf-8');
      fs.renameSync(temp, full);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    const ts = now();
    db.prepare('UPDATE research_plans SET updated_at = ? WHERE id = ?').run(ts, req.params.id);
    res.json({ success: true, updated_at: ts, sha256: sha256(nextContent) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ===== UPDATE METADATA =====
router.put('/:id', (req, res) => {
  const { title, project_id, linked_task_ids, status, tags } = req.body || {};
  const existing = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(req.params.id) as PlanRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (project_id !== undefined && project_id !== existing.project_id) {
    return res.status(400).json({ error: 'Changing a research plan project is not supported' });
  }

  const newTitle = title !== undefined ? String(title) : existing.title;
  const newLinks =
    linked_task_ids !== undefined
      ? JSON.stringify(Array.isArray(linked_task_ids) ? linked_task_ids : [])
      : existing.linked_task_ids;
  const newStatus = status || existing.status;
  const newTags =
    tags !== undefined ? JSON.stringify(Array.isArray(tags) ? tags : []) : existing.tags;
  const ts = now();

  db.prepare(
    `UPDATE research_plans
     SET title = ?, linked_task_ids = ?, status = ?, tags = ?, updated_at = ?
     WHERE id = ?`,
  ).run(newTitle, newLinks, newStatus, newTags, ts, req.params.id);

  const row = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(req.params.id) as PlanRow;
  res.json(row);
});

// ===== DELETE =====
router.delete('/:id', (req, res) => {
  const deleteFile = req.query.deleteFile !== 'false';
  if (db.prepare('SELECT 1 FROM research_runs WHERE research_plan_id = ? LIMIT 1').get(req.params.id)) {
    return res.status(409).json({ error: 'Research plan has run history and can only be archived', code: 'RUN_HISTORY_PROTECTED' });
  }
  const row = db.prepare('SELECT file_name, project_id FROM research_plans WHERE id = ?').get(req.params.id) as
    | { file_name: string; project_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });

  const dir = resolveProjectDir(res, row.project_id);
  if (!dir) return;
  const full = safeResolve(dir, row.file_name);
  if (!full) return res.status(400).json({ error: 'Invalid stored file name' });

  db.prepare('DELETE FROM research_plans WHERE id = ?').run(req.params.id);

  if (deleteFile && fs.existsSync(full)) {
    try { fs.unlinkSync(full); } catch (err) {
      console.error(`Failed to delete ${full}: ${(err as Error).message}`);
    }
  }
  res.json({ success: true });
});

export default router;
