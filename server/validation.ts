import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.js';

const shortText = z.string().trim().max(500);
const longText = z.string().max(1_000_000);
const idText = z.string().trim().min(1).max(200);
const optionalUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict().partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');

export const taskStatusSchema = z.enum(['active', 'paused', 'completed', 'archived']);
export const stepStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'skipped']);

const hpcConfigSchema = z.object({
  host: shortText,
  user: shortText,
  remotePath: z.string().trim().max(4096),
  moduleQE: longText,
  moduleWannier: longText,
  moduleTRIQS: longText,
  nprocs: z.string().trim().max(50),
  connectionMode: z.literal('web-terminal').optional(),
  portalWindowTitle: shortText.optional(),
});

const hpcConfigJsonSchema = z.string().max(100_000).superRefine((value, ctx) => {
  try {
    const parsed = JSON.parse(value);
    const result = hpcConfigSchema.safeParse(parsed);
    if (!result.success) ctx.addIssue({ code: 'custom', message: 'Invalid HPC configuration' });
  } catch {
    ctx.addIssue({ code: 'custom', message: 'HPC configuration must be valid JSON' });
  }
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: longText.optional(),
  material: shortText.optional(),
  working_dir: z.string().trim().max(4096).optional(),
}).strict();

export const projectUpdateSchema = optionalUpdate({
  name: z.string().trim().min(1).max(200),
  description: longText,
  material: shortText,
  working_dir: z.string().trim().max(4096),
  hpc_config: hpcConfigJsonSchema,
});

export const taskCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: longText.optional(),
  workflow_id: idText,
  status: taskStatusSchema.optional(),
}).strict();

export const taskUpdateSchema = optionalUpdate({
  name: z.string().trim().min(1).max(200),
  description: longText,
  status: taskStatusSchema,
});

export const progressUpdateSchema = optionalUpdate({
  status: stepStatusSchema,
  notes: longText,
  commands: z.array(z.string().max(20_000)).max(200),
  lsf_script: longText,
});

export const relativePathSchema = z.string().max(4096).refine(value => {
  const normalized = value.replace(/\\/g, '/');
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) && !normalized.split('/').includes('..');
}, 'Path must be relative and stay inside the working directory');

export const mkdirSchema = z.object({
  path: relativePathSchema.optional().default(''),
  name: z.string().trim().min(1).max(255)
    .refine(value => value !== '.' && value !== '..' && !/[\\/:*?"<>|]/.test(value), 'Invalid directory name'),
}).strict();

export const stepFileCreateSchema = z.object({
  file_path: relativePathSchema,
  file_name: z.string().trim().min(1).max(255),
  description: longText.optional(),
}).strict();

export const experienceCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: longText.refine(value => value.trim().length > 0, 'Content is required'),
  tags: z.array(shortText).max(100).optional(),
  related_project_id: idText.optional().nullable(),
  related_task_id: idText.optional().nullable(),
  related_step_id: idText.optional().nullable(),
  source_task_spec_id: idText.optional().nullable(),
}).strict();

export const experienceUpdateSchema = optionalUpdate({
  title: z.string().trim().min(1).max(500),
  content: longText.refine(value => value.trim().length > 0, 'Content is required'),
  tags: z.array(shortText).max(100),
  related_project_id: idText.nullable(),
  related_task_id: idText.nullable(),
  related_step_id: idText.nullable(),
});

const workflowSubStepSchema = z.object({
  id: idText,
  name: z.string().trim().min(1).max(500),
  description: longText,
  commands: z.array(z.string().max(20_000)).max(200).optional(),
  files: z.array(z.string().max(4096)).max(500).optional(),
}).strict();

const workflowStageSchema = z.object({
  id: idText,
  name: z.string().trim().min(1).max(500),
  color: z.string().max(100),
  colorBg: z.string().max(100),
  colorBorder: z.string().max(100),
  description: longText,
}).strict();

const workflowStepSchema = z.object({
  id: idText,
  stageId: idText,
  order: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(500),
  description: longText,
  commands: z.array(z.string().max(20_000)).max(200).optional(),
  lsfScript: longText.optional(),
  inputFiles: z.array(z.string().max(4096)).max(500).optional(),
  outputFiles: z.array(z.string().max(4096)).max(500).optional(),
  dependsOn: z.array(idText).max(500).optional(),
  preconditions: z.array(z.string().max(4096)).max(500).optional(),
  scientificChecks: z.array(z.string().max(4096)).max(500).optional(),
  successCriteria: z.array(z.string().max(4096)).max(500).optional(),
  failureHandling: z.array(z.string().max(4096)).max(500).optional(),
  approvalPoints: z.array(z.string().max(4096)).max(500).optional(),
  tips: longText.optional(),
  optional: z.boolean().optional(),
  substeps: z.array(workflowSubStepSchema).max(500).optional(),
}).strict();

export const workflowSaveSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  description: longText.optional(),
  stages: z.array(workflowStageSchema).min(1).max(100),
  steps: z.array(workflowStepSchema).max(2000),
}).strict().superRefine((value, ctx) => {
  const stageIds = new Set(value.stages.map(stage => stage.id));
  if (stageIds.size !== value.stages.length) ctx.addIssue({ code: 'custom', message: 'Stage IDs must be unique' });
  const stepIds = new Set(value.steps.map(step => step.id));
  if (stepIds.size !== value.steps.length) ctx.addIssue({ code: 'custom', message: 'Step IDs must be unique' });
  for (const step of value.steps) {
    if (!stageIds.has(step.stageId)) ctx.addIssue({ code: 'custom', message: `Unknown stageId: ${step.stageId}` });
    if (step.dependsOn?.includes(step.id)) ctx.addIssue({ code: 'custom', message: `Step cannot depend on itself: ${step.id}` });
    if (step.dependsOn && new Set(step.dependsOn).size !== step.dependsOn.length) {
      ctx.addIssue({ code: 'custom', message: `Step dependencies must be unique: ${step.id}` });
    }
    for (const dependency of step.dependsOn ?? []) {
      if (!stepIds.has(dependency)) ctx.addIssue({ code: 'custom', message: `Unknown step dependency: ${dependency}` });
    }
  }
});

export const taskSpecStatusSchema = z.enum([
  'draft',
  'awaiting_approval',
  'ready',
  'executing',
  'monitoring',
  'verifying',
  'completed',
  'failed',
  'unknown',
  'blocked',
]);

const stringList = z.array(z.string().trim().min(1).max(4096)).max(200);
const taskSpecFields = {
  title: z.string().trim().min(1).max(500),
  command: z.string().trim().min(1).max(8192),
  execution_payload: z.string().max(200_000).optional(),
  remote_workdir: z.string().trim().min(1).max(4096).optional(),
  dependencies: z.array(idText).max(200).optional(),
  step_dependencies: z.array(idText).max(200).optional(),
  input_files: stringList.optional(),
  expected_outputs: stringList.optional(),
  preconditions: stringList.optional(),
  scientific_checks: stringList.optional(),
  success_criteria: stringList.optional(),
  approval_points: stringList.optional(),
  failure_handling: stringList.optional(),
  failure_policy: z.enum(['stop', 'manual-review']).optional(),
  timeout_seconds: z.number().int().min(1).max(3600).optional(),
};

export const taskSpecCreateSchema = z.object({
  step_id: idText,
  ...taskSpecFields,
}).strict();

export const taskSpecUpdateSchema = optionalUpdate(taskSpecFields);

export const approvalCreateSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  actor: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(20_000).optional(),
}).strict();

export const commandRunFinishSchema = z.object({
  status: z.enum(['completed', 'failed', 'unknown']),
  exit_code: z.number().int().nullable().optional(),
  output_summary: z.string().max(65_536).optional(),
  evidence: z.array(z.object({
    kind: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(20_000),
    source: z.string().trim().max(4096).optional(),
  }).strict()).max(200).optional(),
  error_message: z.string().max(100_000).optional(),
  scheduler_job: z.object({
    scheduler: z.literal('lsf'),
    job_id: z.string().regex(/^\d+$/).max(40),
  }).strict().optional(),
}).strict();

export const schedulerPollFinishSchema = z.object({
  bridge_status: z.enum(['completed', 'failed', 'unknown']),
  scheduler_state: z.enum(['PEND', 'RUN', 'DONE', 'EXIT', 'PSUSP', 'USUSP', 'SSUSP', 'WAIT', 'UNKWN', 'ZOMBI']).optional(),
  raw_summary: z.string().max(65_536).optional(),
  remote_exit_code: z.number().int().nullable().optional(),
  error_message: z.string().max(100_000).optional(),
}).strict();

export const schedulerLogStartSchema = z.object({
  relative_path: z.string().trim().min(1).max(4096).refine(value => {
    const normalized = value.replace(/\\/g, '/');
    const hasControlCharacter = Array.from(normalized).some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f;
    });
    const hasWildcard = ['?', '*', '[', ']', '{', '}'].some(character => normalized.includes(character));
    return !normalized.startsWith('/')
      && !/^[A-Za-z]:\//.test(normalized)
      && !normalized.split('/').includes('..')
      && !hasControlCharacter
      && !hasWildcard;
  }, 'Log path must be a bounded relative path without traversal or wildcards'),
  lines: z.number().int().min(1).max(200).default(80),
}).strict();

export const schedulerLogFinishSchema = z.object({
  bridge_status: z.enum(['completed', 'failed', 'unknown']),
  output_summary: z.string().max(65_536).optional(),
  remote_exit_code: z.number().int().nullable().optional(),
  error_message: z.string().max(100_000).optional(),
}).strict();

export const taskSpecVerifySchema = z.object({
  decision: z.enum(['completed', 'failed', 'blocked']),
  note: z.string().trim().min(1).max(100_000),
  evidence: z.array(z.object({
    kind: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(20_000),
    source: z.string().trim().max(4096).optional(),
  }).strict()).max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === 'completed' && (!value.evidence || value.evidence.length === 0)) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'Completed verification requires explicit evidence' });
  }
});

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'Invalid request', z.flattenError(result.error));
  }
  return result.data;
}

export function validateBody<T>(schema: z.ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parseInput(schema, req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
