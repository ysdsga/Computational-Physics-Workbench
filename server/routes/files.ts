import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { PathBoundaryError, resolveWithinRoot } from '../services/pathSafety.js';

const router = Router({ mergeParams: true });

// Browse files in project working directory
router.get('/', (req, res) => {
  const { projectId } = req.params as { projectId: string };
  const subPath = (req.query.path as string) || '';

  const project = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as { working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.working_dir) return res.status(400).json({ error: 'Project has no working directory set' });

  try {
    const targetPath = resolveWithinRoot(project.working_dir, subPath, { label: 'path' });
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
        relativePath: path.relative(project.working_dir, fullPath),
      };
    }).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ entries, currentPath: subPath, exists: true });
  } catch (err) {
    if (err instanceof PathBoundaryError) return res.status(403).json({ error: err.message, code: 'PATH_OUTSIDE_ROOT' });
    res.status(500).json({ error: `Failed to read directory: ${(err as Error).message}` });
  }
});

// Create a directory
router.post('/mkdir', (req, res) => {
  const { projectId } = req.params as { projectId: string };
  const { path: subPath, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Directory name is required' });

  const project = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as { working_dir: string } | undefined;
  if (!project || !project.working_dir) return res.status(400).json({ error: 'Project has no working directory' });

  try {
    const parentPath = resolveWithinRoot(project.working_dir, subPath || '', { label: 'path' });
    const targetPath = resolveWithinRoot(parentPath, name, { allowRoot: false, label: 'directory name' });
    fs.mkdirSync(targetPath, { recursive: true });
    res.status(201).json({ success: true, path: path.relative(project.working_dir, targetPath) });
  } catch (err) {
    if (err instanceof PathBoundaryError) return res.status(403).json({ error: err.message, code: 'PATH_OUTSIDE_ROOT' });
    res.status(500).json({ error: `Failed to create directory: ${(err as Error).message}` });
  }
});

// Read file content (text files only, max 1MB)
router.get('/read', (req, res) => {
  const { projectId } = req.params as { projectId: string };
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  const project = db.prepare('SELECT working_dir FROM projects WHERE id = ?').get(projectId) as { working_dir: string } | undefined;
  if (!project || !project.working_dir) return res.status(400).json({ error: 'Project has no working directory' });

  try {
    const targetPath = resolveWithinRoot(project.working_dir, filePath, { mustExist: true, allowRoot: false, label: 'path' });
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
    if (stat.size > 1024 * 1024) return res.status(413).json({ error: 'File too large (max 1MB)' });

    const content = fs.readFileSync(targetPath, 'utf-8');
    res.json({ content, name: path.basename(targetPath), size: stat.size });
  } catch (err) {
    if (err instanceof PathBoundaryError) return res.status(403).json({ error: err.message, code: 'PATH_OUTSIDE_ROOT' });
    res.status(500).json({ error: `Failed to read file: ${(err as Error).message}` });
  }
});

export default router;
