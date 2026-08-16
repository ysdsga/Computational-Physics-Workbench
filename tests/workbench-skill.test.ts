import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workbench-agent uses one Envelope confirmation and preserves Codex autonomy', () => {
  const skill = fs.readFileSync(path.join(root, 'skills', 'workbench-agent', 'SKILL.md'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  for (const required of [
    'Codex project conversation as the planning and execution Agent',
    'workbench context --task <id> --allow-blocked --pretty',
    'Confirmed Envelope', 'Working Plan', 'one execution confirmation',
    'Do not request per-Action researcher approval',
    'one Action may own zero, one, or many Jobs',
    'submission_uncertain', 'valid`, `suspect`, `invalid`, and `superseded',
    'Never access `data/workbench.db`', 'Never use generic remote commands',
  ]) assert.ok(skill.includes(required), `skill should include ${required}`);
  assert.doesNotMatch(skill, /action authorize|contract show|policy create|review decide/);
  assert.match(rules, /首次进入执行前/);
  assert.match(rules, /不再逐 Action 请求研究者确认/);
  assert.match(rules, /不得硬编码进执行器、路由或 CLI/);
});

test('documented workbench-agent commands are exposed by the CLI', () => {
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'workbench.js'), '--help'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  for (const command of [
    'context --task <id>', 'hpc show --project <id>', 'plan list', 'plan show --plan <id>', 'plan metadata',
    'workflow show --task <id>', 'run draft', 'run confirm', 'run working-plan',
    'run revise-envelope', 'execution contract', 'action prepare', 'action record',
    'action execute', 'pending list', 'pending create', 'pending resolve',
    'artifact register', 'artifact validity', 'evidence check',
    'experience search', 'experience capture', 'remote status|logs|reconcile',
  ]) assert.ok(help.stderr.includes(command), `CLI help should expose ${command}`);
  for (const removed of ['action authorize', 'policy create', 'contract show', 'review decide']) assert.equal(help.stderr.includes(removed), false);
});
