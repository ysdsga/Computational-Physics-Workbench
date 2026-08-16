import fs from 'fs';
import path from 'path';
import { assertSafeRelativePath, PathBoundaryError, resolveWithinRoot } from './pathSafety.js';

export function sanitizeTaskFolderName(name: string): string {
  const printable = Array.from(name, character => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const sanitized = printable.replace(/[/\\:*?"<>|]/g, '_').trim();
  return !sanitized || sanitized === '.' || sanitized === '..' ? 'unnamed' : sanitized;
}

export function normalizeTaskRootRel(value: unknown): string {
  const safe = assertSafeRelativePath(value, 'task root');
  const normalized = path.normalize(safe);
  if (!normalized || normalized === '.') {
    throw new PathBoundaryError('Task root must be a project subdirectory');
  }
  return assertSafeRelativePath(normalized, 'task root');
}

export function allocateTaskRoot(
  workingDir: string,
  taskName: string,
  taskId: string,
  claimedRoots: Iterable<string>,
): string {
  const claimed = new Set(Array.from(claimedRoots, value => value.toLocaleLowerCase()));
  const base = sanitizeTaskFolderName(taskName);
  let candidate = base;
  const collides = (value: string) => {
    if (claimed.has(value.toLocaleLowerCase())) return true;
    if (!workingDir) return false;
    return fs.existsSync(path.resolve(workingDir, value));
  };
  if (collides(candidate)) candidate = `${base}--${taskId.replace(/[^A-Za-z0-9]/g, '').slice(-8)}`;
  let suffix = 2;
  while (collides(candidate)) {
    candidate = `${base}--${taskId.replace(/[^A-Za-z0-9]/g, '').slice(-8)}-${suffix}`;
    suffix += 1;
  }
  return normalizeTaskRootRel(candidate);
}

export function ensureTaskRoot(workingDir: string, taskRootRel: string): void {
  const normalizedRoot = normalizeTaskRootRel(taskRootRel);
  const taskRoot = resolveWithinRoot(workingDir, normalizedRoot, { allowRoot: false, label: 'task root' });
  fs.mkdirSync(taskRoot, { recursive: true });
}
