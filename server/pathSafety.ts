import fs from 'fs';
import path from 'path';
import { HttpError } from './errors.js';

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function nearestExistingPath(candidate: string): string {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/** Resolve a user-provided path while preventing .., prefix and symlink escapes. */
export function resolveWithinRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);

  if (!isWithin(resolvedRoot, resolvedTarget)) {
    throw new HttpError(403, 'Access denied: path outside working directory');
  }

  if (!fs.existsSync(resolvedRoot)) return resolvedTarget;

  const realRoot = fs.realpathSync(resolvedRoot);
  const existingAncestor = nearestExistingPath(resolvedTarget);
  const realAncestor = fs.realpathSync(existingAncestor);

  if (!isWithin(realRoot, realAncestor)) {
    throw new HttpError(403, 'Access denied: symbolic link escapes working directory');
  }

  if (fs.existsSync(resolvedTarget)) {
    const realTarget = fs.realpathSync(resolvedTarget);
    if (!isWithin(realRoot, realTarget)) {
      throw new HttpError(403, 'Access denied: symbolic link escapes working directory');
    }
  }

  return resolvedTarget;
}

export function relativeToRoot(root: string, target: string): string {
  return path.relative(path.resolve(root), path.resolve(target));
}

