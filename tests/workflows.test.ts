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
  assert.deepEqual(
    workflow.steps.filter(step => step.description.includes('$theory-derivation')).map(step => step.id),
    ['theory-derivation-02', 'theory-validation-02'],
  );
  assert.match(workflow.steps.find(step => step.id === 'theory-validation-02')?.description ?? '', /至少一种独立校验/);
  assert.deepEqual(
    workflow.steps.filter(step => step.description.includes('$literature-research')).map(step => step.id),
    ['theory-context-01', 'theory-context-02'],
  );
  assert.match(workflow.steps.find(step => step.id === 'theory-context-reflection')?.description ?? '', /语义饱和/);
  assert.ok(workflow.steps.find(step => step.id === 'theory-context-01')?.outputFiles?.includes('literature_evidence_matrix.md'));
  assert.ok(workflow.steps.find(step => step.id === 'theory-context-01')?.outputFiles?.includes('pending_literature.md'));
  assert.ok(workflow.steps.find(step => step.id === 'theory-context-02')?.outputFiles?.includes('novelty_audit.md'));
});

test('physics literature reproduction is claim-driven across physics paper types', () => {
  const workflow = getWorkflow('physics-literature-reproduction');
  assert.ok(workflow);
  assert.equal(workflow.name, '物理文献复现');
  assert.deepEqual(
    workflow.stages.map(stage => stage.id),
    ['scope', 'claims', 'resources', 'specification', 'pilot', 'reproduction', 'validation', 'release'],
  );
  assert.deepEqual(
    workflow.stages.map(stage => stage.name),
    ['范围与判据', '主张拆解', '资源与出处', '可执行规格', '最小闭环', '正式复现', '对比与验证', '封装与结论'],
  );

  const stageIds = new Set(workflow.stages.map(stage => stage.id));
  assert.equal(stageIds.size, workflow.stages.length);
  assert.ok(workflow.stages.every(stage => stage.color && stage.colorBg && stage.colorBorder));
  assert.equal(workflow.steps.length, 27);
  assert.equal(new Set(workflow.steps.map(step => step.id)).size, workflow.steps.length);
  assert.ok(workflow.steps.every(step => stageIds.has(step.stageId)));
  assert.deepEqual(
    workflow.stages.map(stage => getStepsForStage(workflow.id, stage.id).length),
    [3, 3, 3, 5, 3, 3, 4, 3],
  );
  assert.equal(getTotalRequiredSteps(workflow.id), 24);

  assert.deepEqual(
    workflow.steps.filter(step => step.optional).map(step => step.id),
    ['repro-spec-theory', 'repro-spec-model', 'repro-spec-material'],
  );
  assert.ok(workflow.steps.every(step => !step.commands?.length));
  assert.ok(workflow.steps.every(step => !step.lsfScript));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('claim_ledger.csv')));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('parameter_provenance.csv')));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('claim_evidence_matrix.md')));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('claim_verdicts.md')));
  assert.ok(workflow.steps.some(step => step.outputFiles?.includes('reproduction_manifest.json')));
  assert.match(workflow.steps.find(step => step.id === 'repro-scope-02')?.description ?? '', /复现深度/);
  assert.match(workflow.steps.find(step => step.id === 'repro-scope-02')?.description ?? '', /独立性模式/);
  assert.match(workflow.steps.find(step => step.id === 'repro-validation-03')?.description ?? '', /可比条件/);
  assert.match(workflow.steps.find(step => step.id === 'repro-validation-04')?.description ?? '', /条件不足无法判断/);
});

test('TRIQS model DMFT is a research-plan-driven core workflow', () => {
  const workflow = getWorkflow('triqs-model-dmft');
  assert.ok(workflow);
  assert.equal(workflow.name, '模型 DMFT（TRIQS）');
  assert.deepEqual(
    workflow.stages.map(stage => stage.id),
    ['model', 'formulation', 'solve', 'measurement', 'validation', 'release'],
  );
  assert.deepEqual(
    workflow.stages.map(stage => stage.name),
    ['模型与目标', 'DMFT 表述与实现', '自洽求解', '收敛态测量', '一致性与验证', '结果分析与发布'],
  );

  const stageIds = new Set(workflow.stages.map(stage => stage.id));
  assert.equal(stageIds.size, workflow.stages.length);
  assert.ok(workflow.stages.every(stage => stage.color && stage.colorBg && stage.colorBorder));
  assert.equal(workflow.steps.length, 20);
  assert.equal(new Set(workflow.steps.map(step => step.id)).size, workflow.steps.length);
  assert.ok(workflow.steps.every(step => stageIds.has(step.stageId)));
  assert.deepEqual(
    workflow.stages.map(stage => getStepsForStage(workflow.id, stage.id).length),
    [3, 5, 3, 3, 3, 3],
  );
  assert.equal(getTotalRequiredSteps(workflow.id), workflow.steps.length);
  assert.ok(workflow.steps.every(step => !step.commands?.length));
  assert.ok(workflow.steps.every(step => !step.lsfScript));
  assert.ok(workflow.steps.every(step => !step.inputFiles?.length && !step.outputFiles?.length));
  assert.ok(workflow.steps.some(step => step.description.includes('研究方案')));
  assert.ok(workflow.steps.some(step => step.description.includes('Working Plan')));
  assert.ok(workflow.steps.some(step => step.name === '检查研究方案所需计算环境'));
  assert.ok(workflow.steps.some(step => step.name === '建立杂质求解方案'));
});
