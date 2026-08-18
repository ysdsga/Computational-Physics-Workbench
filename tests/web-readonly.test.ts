import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const agentPage = fs.readFileSync(new URL('../src/pages/AgentRunsPage.tsx', import.meta.url), 'utf8');
const reviewPage = fs.readFileSync(new URL('../src/pages/ReviewCenterPage.tsx', import.meta.url), 'utf8');
const workflowPage = fs.readFileSync(new URL('../src/pages/TaskWorkflowPage.tsx', import.meta.url), 'utf8');
const evidencePage = fs.readFileSync(new URL('../src/pages/EvidencePage.tsx', import.meta.url), 'utf8');
const supercomputersPage = fs.readFileSync(new URL('../src/pages/SupercomputersPage.tsx', import.meta.url), 'utf8');

test('Agent and review Web pages are read-only observation surfaces', () => {
  for (const forbidden of [
    'contractsApi', 'startRun(', 'terminateRun(', 'createPolicy(', 'adoptPolicy(',
    'inspectRemote(', 'submitSmoke(', 'decideReview(', "method: 'POST'", "method: 'PUT'", "method: 'DELETE'",
  ]) {
    assert.equal(agentPage.includes(forbidden), false, `Agent page must not contain ${forbidden}`);
    assert.equal(reviewPage.includes(forbidden), false, `Review page must not contain ${forbidden}`);
  }
  assert.match(agentPage, /本页显示 Task 会话命令、科学里程碑、作业、证据和恢复状态/);
  assert.match(agentPage, /本机时间 · 非实时终端/);
  assert.match(agentPage, /Agent 按作业规模自适应 · 终态自动清理/);
  assert.match(reviewPage, /页面负责筛选和观察/);
});

test('Workflow, evidence and supercomputer views preserve Agent boundaries', () => {
  assert.match(workflowPage, /observationMap/);
  assert.match(evidencePage, /item\.sha256/);
  assert.match(evidencePage, /agentApi\.evidenceLibrary/);
  assert.match(supercomputersPage, /这里不保存密码或私钥，也不直接执行/);
  assert.match(supercomputersPage, /Task 会话记录/);
  assert.match(supercomputersPage, /不是实时终端，也不提供输入框/);
  for (const source of [evidencePage, supercomputersPage]) {
    assert.doesNotMatch(source, /agentApi\.(startRun|createPolicy|submitSmoke|decideReview|execute|reconcile)/);
  }
});
