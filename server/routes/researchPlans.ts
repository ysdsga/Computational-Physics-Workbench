import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';

const router = Router();

// === Fallback directory for plans NOT associated with any project ===
const GLOBAL_PLANS_DIR = path.resolve(process.cwd(), 'research-plans');

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
 * Resolve the base directory for a plan's file.
 * - If the plan has a project_id, use project.working_dir
 * - Otherwise, fall back to the global research-plans/ dir
 */
function getBaseDir(projectId: string | null): { dir: string; projectFound: boolean } {
  if (projectId) {
    const proj = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as
      | { working_dir: string | null }
      | undefined;
    if (proj?.working_dir) {
      return { dir: proj.working_dir, projectFound: true };
    }
  }
  // fallback: global dir
  if (!fs.existsSync(GLOBAL_PLANS_DIR)) fs.mkdirSync(GLOBAL_PLANS_DIR, { recursive: true });
  return { dir: GLOBAL_PLANS_DIR, projectFound: false };
}

/** Resolve file_name relative to a base dir, blocking path escapes. */
function safeResolve(baseDir: string, fileName: string): string | null {
  if (path.isAbsolute(fileName)) return null;
  const full = path.resolve(baseDir, fileName);
  const root = baseDir + path.sep;
  if (full === baseDir || full.startsWith(root)) return full;
  return null;
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

/**
 * Scan a plan's base dir for *.md and auto-insert metadata rows
 * for files that don't have a DB record yet.
 */
function syncFilesWithDb(projectId: string | null): void {
  const { dir } = getBaseDir(projectId);
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
    const pid = projectId || null;
    const existing = pid
      ? db.prepare('SELECT id FROM research_plans WHERE file_name = ? AND project_id = ?').get(f, pid)
      : db.prepare('SELECT id FROM research_plans WHERE file_name = ? AND project_id IS NULL').get(f);
    if (!existing) {
      insert.run(newId(), f, fileNameToTitle(f), pid, ts, ts);
    }
  }
}

// ===== LIST =====
router.get('/', (req, res) => {
  let query = 'SELECT * FROM research_plans';
  const params: string[] = [];
  const conds: string[] = [];
  const { projectId, status, search } = req.query;

  // If projectId given, also sync files from that project's dir first
  if (projectId) {
    syncFilesWithDb(projectId as string);
  } else {
    // sync global dir + all known project dirs
    syncFilesWithDb(null);
    const allProjs = db.prepare('SELECT DISTINCT project_id FROM research_plans WHERE project_id IS NOT NULL').all() as
      | { project_id: string }[]
      | [];
    allProjs.forEach(p => syncFilesWithDb(p.project_id));
  }

  if (projectId) {
    conds.push('project_id = ?');
    params.push(projectId as string);
  }
  if (status) {
    conds.push('status = ?');
    params.push(status as string);
  }
  if (search) {
    conds.push('(title LIKE ? OR tags LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY updated_at DESC';

  const rows = db.prepare(query).all(...params) as PlanRow[];

  // Annotate with missing flag
  const annotated = rows.map(r => {
    const { dir } = getBaseDir(r.project_id);
    const exists = fs.existsSync(path.join(dir, r.file_name));
    return { ...r, missing: !exists };
  });
  res.json(annotated);
});

// ===== IMPORT (must come before /:id) =====
router.post('/import', (req, res) => {
  const { sourcePath, fileName, content, project_id } = req.body || {};
  if (!sourcePath && content === undefined) {
    return res.status(400).json({ error: 'Provide either sourcePath or content' });
  }

  const pid = project_id || null;
  const { dir } = getBaseDir(pid);

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
  const pid = project_id || null;
  const { dir } = getBaseDir(pid);
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
  const { dir } = getBaseDir(row.project_id);
  const exists = fs.existsSync(path.join(dir, row.file_name));
  res.json({ ...row, missing: !exists });
});

// ===== GET CONTENT =====
router.get('/:id/content', (req, res) => {
  const row = db.prepare('SELECT file_name, project_id FROM research_plans WHERE id = ?').get(req.params.id) as
    | { file_name: string; project_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { dir } = getBaseDir(row.project_id);
  const full = path.join(dir, row.file_name);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: `File missing on disk: ${row.file_name}` });
  }
  try {
    const stat = fs.statSync(full);
    if (stat.size > 10 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 10MB)' });
    const content = fs.readFileSync(full, 'utf-8');
    res.json({ content, size: stat.size, modified: stat.mtime.toISOString() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ===== PUT CONTENT =====
router.put('/:id/content', (req, res) => {
  const { content } = req.body || {};
  if (content === undefined) return res.status(400).json({ error: 'content is required' });
  const row = db.prepare('SELECT file_name, project_id FROM research_plans WHERE id = ?').get(req.params.id) as
    | { file_name: string; project_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { dir } = getBaseDir(row.project_id);
  const full = path.join(dir, row.file_name);
  try {
    fs.writeFileSync(full, String(content), 'utf-8');
    const ts = now();
    db.prepare('UPDATE research_plans SET updated_at = ? WHERE id = ?').run(ts, req.params.id);
    res.json({ success: true, updated_at: ts });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ===== UPDATE METADATA =====
router.put('/:id', (req, res) => {
  const { title, project_id, linked_task_ids, status, tags } = req.body || {};
  const existing = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(req.params.id) as PlanRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const newTitle = title !== undefined ? String(title) : existing.title;
  const newPid = project_id !== undefined ? (project_id || null) : existing.project_id;
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
     SET title = ?, project_id = ?, linked_task_ids = ?, status = ?, tags = ?, updated_at = ?
     WHERE id = ?`,
  ).run(newTitle, newPid, newLinks, newStatus, newTags, ts, req.params.id);

  const row = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(req.params.id) as PlanRow;
  res.json(row);
});

// ===== DELETE =====
router.delete('/:id', (req, res) => {
  const deleteFile = req.query.deleteFile !== 'false';
  const row = db.prepare('SELECT file_name, project_id FROM research_plans WHERE id = ?').get(req.params.id) as
    | { file_name: string; project_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM research_plans WHERE id = ?').run(req.params.id);

  if (deleteFile) {
    const { dir } = getBaseDir(row.project_id);
    const full = path.join(dir, row.file_name);
    if (fs.existsSync(full)) {
      try { fs.unlinkSync(full); } catch (err) {
        console.error(`Failed to delete ${full}: ${(err as Error).message}`);
      }
    }
  }
  res.json({ success: true });
});

export default router;
