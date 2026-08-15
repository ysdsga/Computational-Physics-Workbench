import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeRelativePath, isPathInside, PathBoundaryError, resolveWithinRoot } from '../server/services/pathSafety.js';
import { allocateTaskRoot, normalizeTaskRootRel, sanitizeTaskFolderName } from '../server/services/taskRoots.js';

test('path boundary rejects traversal, absolute paths and same-prefix siblings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-path-'));
  const sibling = `${root}-other`;
  fs.mkdirSync(sibling);
  try {
    for (const candidate of ['../escape', '..\\escape', path.resolve(root, '..', 'escape')]) {
      assert.throws(() => resolveWithinRoot(root, candidate), PathBoundaryError);
    }
    assert.equal(isPathInside(root, sibling), false);
    assert.throws(() => assertSafeRelativePath('C:\\escape'));
    assert.equal(resolveWithinRoot(root, 'safe/file.txt'), path.join(root, 'safe', 'file.txt'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('path boundary resolves symlinks and task roots remain stable on rename', { skip: process.platform === 'win32' && !process.env.CI }, () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-link-'));
  const root = path.join(parent, 'root'); const outside = path.join(parent, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  try { assert.throws(() => resolveWithinRoot(root, 'link/file.txt'), PathBoundaryError); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('task root allocator appends short task id for collisions without depending on later display-name changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-task-root-'));
  fs.mkdirSync(path.join(root, 'calculation'));
  try {
    const allocated = allocateTaskRoot(root, 'calculation', 'task-12345678', []);
    assert.match(allocated, /^calculation--12345678/);
    assert.equal(allocateTaskRoot(root, 'renamed', 'task-12345678', [allocated]), 'renamed');
    assert.equal(sanitizeTaskFolderName('.'), 'unnamed');
    assert.equal(normalizeTaskRootRel('nested/./task'), path.join('nested', 'task'));
    assert.throws(() => normalizeTaskRootRel('.'), PathBoundaryError);
    assert.throws(() => normalizeTaskRootRel(''), PathBoundaryError);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
