import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { resolveWithinRoot, relativeToRoot } from '../pathSafety.js';
import { mkdirSchema, parseInput, relativePathSchema, validateBody } from '../validation.js';

const router = Router({ mergeParams: true });

// Browse files in project working directory
router.get('/', (req, res) => {
  const projectId = String((req.params as Record<string, string | undefined>).projectId);
  const subPath = parseInput(relativePathSchema, (req.query.path as string) || '');

  const project = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as { working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.working_dir) return res.status(400).json({ error: 'Project has no working directory set' });

  const targetPath = resolveWithinRoot(project.working_dir, subPath);

  try {
    if (!fs.existsSync(targetPath)) {
      return res.json({ entries: [], currentPath: subPath, exists: false });
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true }).map(dirent => {
      const fullPath = path.join(targetPath, dirent.name);
      const stat = fs.statSync(fullPath);
      return {
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        relativePath: relativeToRoot(project.working_dir, fullPath),
      };
    }).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ entries, currentPath: subPath, exists: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to read directory: ${(err as Error).message}` });
  }
});

// Create a directory
router.post('/mkdir', validateBody(mkdirSchema), (req, res) => {
  const projectId = String((req.params as Record<string, string | undefined>).projectId);
  const { path: subPath, name } = req.body;
  const project = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as { working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.working_dir) return res.status(400).json({ error: 'Project has no working directory' });

  const targetPath = resolveWithinRoot(project.working_dir, subPath || '', name);

  try {
    fs.mkdirSync(targetPath, { recursive: true });
    res.status(201).json({ success: true, path: relativeToRoot(project.working_dir, targetPath) });
  } catch (err) {
    res.status(500).json({ error: `Failed to create directory: ${(err as Error).message}` });
  }
});

// Read file content (text files only, max 1MB)
router.get('/read', (req, res) => {
  const projectId = String((req.params as Record<string, string | undefined>).projectId);
  const filePath = parseInput(relativePathSchema.refine(value => value.length > 0, 'Path is required'), req.query.path);

  const project = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as { working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.working_dir) return res.status(400).json({ error: 'Project has no working directory' });

  const targetPath = resolveWithinRoot(project.working_dir, filePath);

  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
    if (stat.size > 1024 * 1024) return res.status(413).json({ error: 'File too large (max 1MB)' });

    const content = fs.readFileSync(targetPath, 'utf-8');
    res.json({ content, name: path.basename(targetPath), size: stat.size });
  } catch (err) {
    res.status(500).json({ error: `Failed to read file: ${(err as Error).message}` });
  }
});

export default router;
