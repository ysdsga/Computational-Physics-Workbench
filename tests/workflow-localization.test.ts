import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKFLOWS } from '../src/data/workflows.js';
import { ENGLISH_WORKFLOW_COPY } from '../src/data/workflow-english.js';
import { localizeWorkflow } from '../src/data/workflow-localization.js';

test('every built-in workflow, stage, step, tip and substep has English display copy', () => {
  assert.equal(WORKFLOWS.length, 4);
  assert.deepEqual(Object.keys(ENGLISH_WORKFLOW_COPY).sort(), WORKFLOWS.map(item => item.id).sort());
  for (const raw of WORKFLOWS) {
    const copy = ENGLISH_WORKFLOW_COPY[raw.id];
    assert.deepEqual(Object.keys(copy.stages).sort(), raw.stages.map(item => item.id).sort(), raw.id);
    assert.deepEqual(Object.keys(copy.steps).sort(), raw.steps.map(item => item.id).sort(), raw.id);
    assert.deepEqual(Object.keys(copy.substeps ?? {}).sort(), raw.steps.flatMap(item => item.substeps?.map(sub => sub.id) ?? []).sort(), raw.id);
    const english = localizeWorkflow(raw, 'en');
    const prose = [english.name, english.description];
    for (const stage of english.stages) prose.push(stage.name, stage.description);
    for (const step of english.steps) {
      prose.push(step.name, step.description, step.tips ?? '', ...(step.inputFiles ?? []));
      for (const substep of step.substeps ?? []) prose.push(substep.name, substep.description);
    }
    assert.doesNotMatch(prose.join('\n'), /\p{Script=Han}/u, raw.id);
    assert.ok(english.stages.every(stage => stage.name && stage.description));
    assert.ok(english.steps.every(step => step.name && step.description));
  }
});

test('projection preserves authoritative Chinese data, workflow topology and executable fields', () => {
  const before = JSON.stringify(WORKFLOWS);
  for (const raw of WORKFLOWS) {
    const english = localizeWorkflow(raw, 'en');
    assert.equal(localizeWorkflow(raw, 'zh-CN'), raw);
    assert.deepEqual(localizeWorkflow(english, 'en'), english, 'English projection is idempotent');
    assert.equal(english.id, raw.id);
    assert.deepEqual(english.stages.map(stage => stage.id), raw.stages.map(stage => stage.id));
    assert.deepEqual(english.steps.map(step => step.id), raw.steps.map(step => step.id));
    for (const [index, step] of english.steps.entries()) {
      const source = raw.steps[index];
      for (const key of ['stageId', 'order', 'optional', 'commands', 'lsfScript', 'outputFiles'] as const) {
        assert.deepEqual(step[key], source[key], `${raw.id}/${step.id}/${key}`);
      }
      if (step.id !== 'prep-03') assert.deepEqual(step.inputFiles, source.inputFiles);
      for (const [subIndex, substep] of (step.substeps ?? []).entries()) {
        assert.equal(substep.id, source.substeps![subIndex].id);
        assert.deepEqual(substep.commands, source.substeps![subIndex].commands);
        assert.deepEqual(substep.files, source.substeps![subIndex].files);
      }
    }
    for (const [index, stage] of english.stages.entries()) {
      for (const key of ['color', 'colorBg', 'colorBorder'] as const) assert.equal(stage[key], raw.stages[index][key]);
    }
  }
  assert.equal(JSON.stringify(WORKFLOWS), before, 'rendering must never mutate saved/default templates');
});

test('custom prose is retained field by field, even when it resembles another built-in string', () => {
  const raw = structuredClone(WORKFLOWS[0]);
  raw.name = '我的自定义模板';
  raw.description = 'Custom description';
  raw.stages[0].name = 'Custom preparation';
  raw.steps[0].name = raw.steps[1].name;
  raw.steps[0].description = '自定义科学要求';
  raw.steps[1].tips = 'Custom advice';
  raw.steps[2].substeps![0].description = 'Custom source';
  raw.steps[2].inputFiles!.push('custom.in');
  const before = structuredClone(raw);
  const english = localizeWorkflow(raw, 'en');
  assert.equal(english.name, raw.name);
  assert.equal(english.description, raw.description);
  assert.equal(english.stages[0].name, raw.stages[0].name);
  assert.notEqual(english.stages[0].description, raw.stages[0].description);
  assert.equal(english.steps[0].name, raw.steps[0].name);
  assert.equal(english.steps[0].description, raw.steps[0].description);
  assert.equal(english.steps[1].tips, raw.steps[1].tips);
  assert.equal(english.steps[2].substeps![0].description, 'Custom source');
  assert.deepEqual(english.steps[2].inputFiles, raw.steps[2].inputFiles);
  assert.deepEqual(raw, before);
});

test('custom IDs, deletions, ordering and saved task scientific settings stay authoritative', () => {
  const raw = structuredClone(WORKFLOWS[0]);
  raw.stages = raw.stages.slice(1).reverse();
  raw.steps = raw.steps.slice(1).reverse();
  raw.steps[0].commands = ['echo "我的命令"'];
  raw.steps[0].lsfScript = '#BSUB -n 13\npython own_solver.py --U 7.25';
  raw.steps[0].outputFiles = ['结果.dat'];
  raw.steps.push({ id: 'custom-step', stageId: 'check', order: 100, name: '自定义步骤', description: '研究者内容' });
  const english = localizeWorkflow(raw, 'en');
  assert.deepEqual(english.stages.map(stage => stage.id), raw.stages.map(stage => stage.id));
  assert.deepEqual(english.steps.map(step => step.id), raw.steps.map(step => step.id));
  assert.deepEqual(english.steps.at(-1), raw.steps.at(-1));
  assert.deepEqual(english.steps[0].commands, raw.steps[0].commands);
  assert.equal(english.steps[0].lsfScript, raw.steps[0].lsfScript);
  assert.deepEqual(english.steps[0].outputFiles, raw.steps[0].outputFiles);
  const custom = { ...raw, id: 'custom-workflow' };
  assert.equal(localizeWorkflow(custom, 'en'), custom);
});

test('English scientific guidance retains evidence, convergence and research-goal boundaries', () => {
  const workflows = WORKFLOWS.map(raw => localizeWorkflow(raw, 'en'));
  const step = (workflowId: string, stepId: string) => workflows.find(item => item.id === workflowId)!.steps.find(item => item.id === stepId)!;
  assert.match(step('triqs-model-dmft', 'model-dmft-validation-01').description, /all available iterations/);
  assert.match(step('triqs-model-dmft', 'model-dmft-validation-01').description, /last 5–10/);
  assert.match(step('triqs-model-dmft', 'model-dmft-validation-03').description, /Stop by default/);
  assert.match(step('theoretical-research', 'theory-context-reflection').description, /semantic saturation/);
  assert.match(step('theoretical-research', 'theory-validation-02').description, /at least one independent check/);
  assert.match(step('theoretical-research', 'theory-interpretation-04').description, /goalAssessment must address every original success criterion/);
  assert.match(step('physics-literature-reproduction', 'repro-validation-04').description, /inconclusive/);
  assert.match(step('physics-literature-reproduction', 'repro-release-03').description, /researcher reviews and confirms/);
});
