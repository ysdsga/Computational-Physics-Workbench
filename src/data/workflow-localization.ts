import type { WorkflowTemplate } from '../types';
import { WORKFLOWS } from './workflows';
import { ENGLISH_WORKFLOW_COPY } from './workflow-english';

/**
 * Project unchanged built-in prose into the chosen display language.
 * The database/task snapshot remains authoritative: match IDs and exact field
 * values, preserve custom text, deleted/reordered nodes and all executable data.
 * Never pass this display projection to an editor or save it to the API.
 */
export function localizeWorkflow(workflow: WorkflowTemplate, locale: 'en' | 'zh-CN'): WorkflowTemplate {
  if (locale !== 'en') return workflow;
  const builtin = WORKFLOWS.find(item => item.id === workflow.id);
  const copy = ENGLISH_WORKFLOW_COPY[workflow.id];
  if (!builtin || !copy) return workflow;

  const translate = (current: string, original: string, english: string) => current === original ? english : current;
  return {
    ...workflow,
    name: translate(workflow.name, builtin.name, copy.name),
    description: translate(workflow.description, builtin.description, copy.description),
    stages: workflow.stages.map(stage => {
      const original = builtin.stages.find(item => item.id === stage.id);
      const translated = copy.stages[stage.id];
      return original && translated ? {
        ...stage,
        name: translate(stage.name, original.name, translated[0]),
        description: translate(stage.description, original.description, translated[1]),
      } : stage;
    }),
    steps: workflow.steps.map(step => {
      const original = builtin.steps.find(item => item.id === step.id);
      const translated = copy.steps[step.id];
      if (!original || !translated) return step;
      return {
        ...step,
        name: translate(step.name, original.name, translated[0]),
        description: translate(step.description, original.description, translated[1]),
        ...(step.tips !== undefined && original.tips !== undefined && translated[2] !== undefined
          ? { tips: translate(step.tips, original.tips, translated[2]) } : {}),
        // These two built-in values are descriptive labels, not literal paths.
        ...(workflow.id === 'dft-dmft-oneshot' && step.id === 'prep-03' && step.inputFiles
          && JSON.stringify(step.inputFiles) === JSON.stringify(original.inputFiles) ? {
          inputFiles: step.inputFiles.map(file => file === 'cif 结构文件' ? 'CIF structure file' : file === 'upf 赝势文件' ? 'UPF pseudopotential files' : file),
        } : {}),
        ...(step.substeps ? {
          substeps: step.substeps.map(substep => {
            const originalSubstep = original.substeps?.find(item => item.id === substep.id);
            const translatedSubstep = copy.substeps?.[substep.id];
            return originalSubstep && translatedSubstep ? {
              ...substep,
              name: translate(substep.name, originalSubstep.name, translatedSubstep[0]),
              description: translate(substep.description, originalSubstep.description, translatedSubstep[1]),
            } : substep;
          }),
        } : {}),
      };
    }),
  };
}
