import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(root, 'skills');

test('workbench-agent uses one Envelope confirmation and preserves Codex autonomy', () => {
  const skill = fs.readFileSync(path.join(skillsRoot, 'workbench-agent', 'SKILL.md'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  for (const required of [
    'Codex project conversation as the planning and execution Agent',
    'workbench context --task <id> --allow-blocked --pretty',
    'Confirmed Envelope', 'Working Plan', 'one execution confirmation',
    'Do not request per-Action approval',
    'do not create Actions or consume scientific retry budget',
    'Action is an automatically recorded unit of scientific work, not permission for every machine call',
    'workbench remote exec',
    'one Action may own zero, one, or many Jobs',
    'submission_uncertain', 'valid`, `suspect`, `invalid`, and `superseded',
    'current-chat Scheduled Task monitor', 'workbench monitor guard', '--retry-of',
    'expectedRunMinutes', 'monitor directive', 'automation-state active', 'monitor close', 'heartbeat lease',
    'explorationReviewRequired', 'workingPlan.explorationReview', 'materially change, extend, or overturn',
    '`resolved` or `falsified`', '`deferred`, or `follow_up`', '`evidenceRefs`',
    'counterexamples, competing mechanisms, controlled limits, and testable predictions', 'There is no idea quota',
    'workbench reflection record', 'earliest confirmed stage affected', 'does not by itself modify the Research Plan',
    'Never access `data/workbench.db`', 'Never use a material-specific adapter',
  ]) assert.ok(skill.includes(required), `skill should include ${required}`);
  assert.doesNotMatch(skill, /action authorize|contract show|policy create|review decide/);
  assert.match(rules, /首次进入执行前/);
  assert.match(rules, /不再逐命令或逐 Action 请求研究者确认/);
  assert.match(rules, /连接、认证、超时、建目录、检查和传输失败只写 event/);
  assert.match(rules, /不得硬编码进执行器、路由或 CLI/);
});

test('repository bundles every skill referenced by built-in scientific workflows', () => {
  const bundledSkills = ['workbench-agent', 'literature-research', 'theory-derivation'];
  for (const skillName of bundledSkills) {
    assert.ok(fs.existsSync(path.join(skillsRoot, skillName, 'SKILL.md')), `${skillName} should provide SKILL.md`);
    assert.ok(fs.existsSync(path.join(skillsRoot, skillName, 'agents', 'openai.yaml')), `${skillName} should provide agents/openai.yaml`);
  }

  const workflows = fs.readFileSync(path.join(root, 'src', 'data', 'workflows.ts'), 'utf8');
  for (const match of workflows.matchAll(/\$([a-z][a-z0-9-]+)/g)) {
    assert.ok(fs.existsSync(path.join(skillsRoot, match[1], 'SKILL.md')), `workflow-referenced skill ${match[1]} should be bundled`);
  }

  const portableFiles = [
    path.join(skillsRoot, 'workbench-agent', 'SKILL.md'),
    path.join(skillsRoot, 'literature-research', 'SKILL.md'),
    path.join(skillsRoot, 'literature-research', 'references', 'coverage-protocol.md'),
    path.join(skillsRoot, 'theory-derivation', 'SKILL.md'),
    path.join(skillsRoot, 'theory-derivation', 'references', 'tool-routing.md'),
  ];
  const portableText = portableFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(portableText, /C:\\Users\\pikaqiu|\/home\/pika|D:\\DFT\+DMFT workbench/i);
});

test('documented workbench-agent commands are exposed by the CLI', () => {
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'workbench.js'), '--help'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  for (const command of [
    'context --task <id>', 'hpc show --project <id>', 'plan list', 'plan show --plan <id>', 'plan metadata',
    'workflow show --task <id>', 'run draft', 'run confirm', 'run working-plan', 'reflection record',
    'run revise-envelope', 'execution contract', 'action prepare', 'action record',
    'action execute', 'pending list', 'pending create', 'pending resolve',
    'artifact register', 'artifact validity', 'evidence check',
    'experience search', 'experience capture', 'remote session|init', 'remote exec', 'remote upload', 'remote download', 'remote status|logs|reconcile', 'monitor guard', 'monitor show|tick|directive', 'monitor attach', 'monitor sync', 'monitor pause', 'monitor close',
  ]) assert.ok(help.stderr.includes(command), `CLI help should expose ${command}`);
  for (const removed of ['action authorize', 'policy create', 'contract show', 'review decide']) assert.equal(help.stderr.includes(removed), false);
});
