import fs from 'fs';
import path from 'path';

export class PathBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathBoundaryError';
  }
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).some(segment => segment === '..');
}

export function assertSafeRelativePath(value: unknown, label = 'path'): string {
  if (typeof value !== 'string') throw new PathBoundaryError(`${label} must be a string`);
  if (value.includes('\0')) throw new PathBoundaryError(`${label} contains a null byte`);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new PathBoundaryError(`${label} must be relative`);
  }
  if (hasTraversalSegment(value)) throw new PathBoundaryError(`${label} cannot contain ..`);
  return value;
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function closestExistingAncestor(target: string): string {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new PathBoundaryError(`No existing ancestor for ${target}`);
    current = parent;
  }
  return current;
}

function canonicalizePotentialPath(target: string): string {
  const absolute = path.resolve(target);
  const existing = closestExistingAncestor(absolute);
  const realExisting = fs.realpathSync.native(existing);
  const suffix = path.relative(existing, absolute);
  return path.resolve(realExisting, suffix);
}

export interface ResolveWithinRootOptions {
  mustExist?: boolean;
  allowRoot?: boolean;
  label?: string;
}

/**
 * Resolve a relative path inside a root while accounting for Windows path
 * semantics and symlinks in the nearest existing ancestor.
 */
export function resolveWithinRoot(
  root: string,
  relativePath = '',
  options: ResolveWithinRootOptions = {},
): string {
  if (!root?.trim()) throw new PathBoundaryError('Root path is required');
  const safeRelative = assertSafeRelativePath(relativePath, options.label ?? 'path');
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(absoluteRoot, safeRelative);

  if (!isPathInside(absoluteRoot, absoluteTarget)) {
    throw new PathBoundaryError('Path is outside the allowed root');
  }
  if (options.allowRoot === false && absoluteTarget === absoluteRoot) {
    throw new PathBoundaryError('The root directory itself is not a valid target');
  }
  if (options.mustExist && !fs.existsSync(absoluteTarget)) {
    throw new PathBoundaryError('Path does not exist');
  }

  const canonicalRoot = canonicalizePotentialPath(absoluteRoot);
  const canonicalTarget = canonicalizePotentialPath(absoluteTarget);
  if (!isPathInside(canonicalRoot, canonicalTarget)) {
    throw new PathBoundaryError('Path resolves outside the allowed root');
  }
  return absoluteTarget;
}

export function toSafeRelativePath(root: string, target: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assertSafeRelativePath(relative);
  return relative;
}
