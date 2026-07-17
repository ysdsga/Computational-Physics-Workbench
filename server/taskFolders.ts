import fs from 'fs';
import path from 'path';
import type { WorkflowTemplate } from '../src/types/index.js';
import { resolveWithinRoot } from './pathSafety.js';

export function sanitizeTaskFolderName(name: string): string {
  let sanitized = name.replace(/[/\\:*?"<>|]/g, '_').trim().replace(/[. ]+$/g, '');
  if (!sanitized || sanitized === '.' || sanitized === '..') sanitized = 'unnamed';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) sanitized = `_${sanitized}`;
  return sanitized;
}

export function createTaskFolders(workingDir: string, folderName: string, workflow: WorkflowTemplate): void {
  fs.mkdirSync(workingDir, { recursive: true });
  const taskBasePath = resolveWithinRoot(workingDir, folderName);

  for (const stage of workflow.stages) {
    const stagePath = resolveWithinRoot(taskBasePath, stage.id);
    fs.mkdirSync(stagePath, { recursive: true });
  }
}

export function taskStagePath(folderName: string, stageId: string): string {
  return path.join(folderName, stageId);
}
