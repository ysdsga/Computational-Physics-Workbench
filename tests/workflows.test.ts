import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKFLOWS,
  getStepsForStage,
  getTotalRequiredSteps,
  getWorkflow,
} from '../src/data/workflows.js';

test('theoretical research is a complete non-computational built-in workflow', () => {
  assert.equal(WORKFLOWS.length, 4);

  const workflow = getWorkflow('theoretical-research');
  assert.ok(workflow);
  assert.equal(workflow.name, '理论研究');
  assert.deepEqual(
    workflow.stages.map(stage => stage.id),
    ['question', 'context', 'model', 'baseline', 'derivation', 'validation', 'interpretation', 'release'],
  );
  assert.deepEqual(
    workflow.stages.map(stage => stage.name),
    ['问题定义', '文献与约束', '模型与假设', '基准极限', '核心推导', '一致性验证', '解释与预测', '成果封装'],
  );

  const stageIds = new Set(workflow.stages.map(stage => stage.id));
  assert.equal(stageIds.size, workflow.stages.length);
  assert.ok(workflow.stages.every(stage => stage.color && stage.colorBg && stage.colorBorder));
  assert.equal(workflow.steps.length, 27);
  assert.equal(new Set(workflow.steps.map(step => step.id)).size, workflow.steps.length);
  assert.ok(workflow.steps.every(step => stageIds.has(step.stageId)));
  assert.deepEqual(
    workflow.stages.map(stage => getStepsForStage(workflow.id, stage.id).length),
    [3, 3, 4, 3, 4, 3, 4, 3],
  );
  assert.equal(getTotalRequiredSteps(workflow.id), workflow.steps.length);

  assert.ok(workflow.steps.every(step => !step.commands?.length));
  assert.ok(workflow.steps.every(step => !step.lsfScript));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('theory_report.md')));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('evidence_index.md')));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('exploration_review.md')));
  assert.equal(workflow.steps.filter(step => step.name.includes('反思')).length, workflow.stages.length);
  const reflectionSteps = workflow.steps.filter(step => step.name.includes('反思'));
  assert.ok(reflectionSteps.every(step => step.description.includes('反例、竞争机制、可控极限和可检验预测')));
  assert.ok(reflectionSteps.every(step => step.description.includes('不设数量指标，不为凑数制造想法')));
});
