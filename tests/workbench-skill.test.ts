import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workbench-agent protocol keeps Codex as the agent and Web as a read-only observer', () => {
  const skill = fs.readFileSync(path.join(root, 'skills', 'workbench-agent', 'SKILL.md'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

  for (const required of [
    'The Codex project conversation is the Agent',
    'Web Agent/Review/Evidence surfaces only display recorded state',
    'workbench context --task <id> --allow-blocked --pretty',
    'execution contract',
    'action prepare',
    'action propose',
    'action authorize',
    'action execute',
    'deterministic execution manifest',
    'submission_uncertain',
    'never an execution route',
    'Do not access `data/workbench.db`',
    'Do not use generic `ssh`',
  ]) assert.match(skill, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(rules, /Agent 本体是本项目中的 Codex 对话/);
  assert.match(rules, /Web 页面只能展示已记录状态/);
  assert.match(rules, /不得把沉默、历史上的宽泛目标、Web 状态或 Agent 自己的建议当作授权/);
  assert.match(rules, /不得硬编码进执行器、路由或 CLI/);

  const productExecutionSurface = [
    path.join(root, 'server', 'services', 'actionExecutor.ts'),
    path.join(root, 'server', 'routes', 'agent.ts'),
    path.join(root, 'bin', 'workbench.js'),
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(productExecutionSurface, /cacro3|material-a|material-b|submit-scf|10_scf/i);
});

test('documented workbench-agent protocol commands are exposed by the CLI', () => {
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'workbench.js'), '--help'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(help.status, 0, help.stderr);
  for (const command of [
    'context --task <id>',
    'hpc show --project <id>',
    'hpc configure --project <id> --file <json>',
    'plan show --plan <id>',
    'workflow show --task <id>',
    'execution contract',
    'action prepare',
    'action propose',
    'action authorize',
    'action execute',
    'artifact register',
    'evidence check',
    'experience search',
    'experience capture',
  ]) assert.ok(help.stderr.includes(command), `CLI help should expose ${command}`);
});
