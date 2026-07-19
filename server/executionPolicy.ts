import { createHash } from 'crypto';

export type CommandRiskClass = 'read-only' | 'submit' | 'mutating' | 'submit+mutating' | 'blocked';

export interface CommandRisk {
  riskClass: CommandRiskClass;
  blockedReasons: string[];
  requiresSubmitApproval: boolean;
  requiresMutationApproval: boolean;
}

export const MAX_REMOTE_COMMAND_LENGTH = 8192;
export const MAX_EXECUTION_PAYLOAD_LENGTH = 200_000;

const blockedPatterns: Array<[string, RegExp]> = [
  ['interactive program', /\b(vi|vim|nano|emacs|top|htop|less|more|watch)\b/im],
  ['software installation', /\b(conda|mamba|pip|pip3)\s+install\b/im],
  ['network or file-transfer command', /\b(ssh|scp|sftp|rsync|curl|wget|nc|ncat|telnet)\b/im],
  ['terminal session control', /\b(exit|logout|exec)\b/im],
  ['directory change or parent traversal', /(^|[;&|]\s*)(cd|pushd|popd)\b|(^|[\s"'=])\.\.(?:\/|$)/im],
  ['absolute or home-relative path', /(?<![\w.#!:])\/[^\s"';&|<>()]*|(?<![\w#])~(?:[A-Za-z0-9_.-]+)?(?:\/|(?=\s|$))|\$(?:HOME|TMPDIR|SCRATCH)(?:\/|\b)|\$\{(?:HOME|TMPDIR|SCRATCH)\}(?:\/|\b)/im],
  ['broad filesystem scan', /(^|[;&|]\s*)(find|locate|tree)\b|\bls\s+[^\r\n;&|]*-[a-z]*R[a-z]*\b/im],
  ['indirect command evaluation', /\beval\b|(^|[;&|]\s*)(bash|sh|zsh|fish)\s+-[a-z]*c\b|(^|[;&|]\s*)(python|python3|perl|ruby|node)\s+-(c|e)\b/im],
  ['detached or background execution', /\bnohup\b|(?<![>&])&(?![>&])/m],
];

function buildRisk(blockedReasons: string[], requiresSubmitApproval: boolean, requiresMutationApproval: boolean): CommandRisk {
  let riskClass: CommandRiskClass = 'read-only';
  if (blockedReasons.length) riskClass = 'blocked';
  else if (requiresSubmitApproval && requiresMutationApproval) riskClass = 'submit+mutating';
  else if (requiresSubmitApproval) riskClass = 'submit';
  else if (requiresMutationApproval) riskClass = 'mutating';
  return { riskClass, blockedReasons, requiresSubmitApproval, requiresMutationApproval };
}

export function classifyCommand(command: string, maxLength = MAX_REMOTE_COMMAND_LENGTH): CommandRisk {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Remote command is empty');
  if (trimmed.length > maxLength) throw new Error(`Remote command exceeds the ${maxLength}-character limit`);

  const blockedReasons = blockedPatterns
    .filter(([, pattern]) => pattern.test(trimmed))
    .map(([reason]) => reason);
  const requiresSubmitApproval = /\b(bsub|sbatch|qsub)\b/im.test(trimmed);
  const requiresMutationApproval =
    /\b(rm|rmdir|unlink|shred|truncate|dd|mkfs(?:\.[a-z0-9]+)?|mv|chmod|chown|kill|pkill|bkill|qdel|scancel|bmod)\b/im.test(trimmed)
    || /\bsed\s+[^\r\n;&|]*-[a-z]*i[a-z]*\b/im.test(trimmed)
    || /(^|[^<])>{1,2}(?![>&])/m.test(trimmed);

  return buildRisk(blockedReasons, requiresSubmitApproval, requiresMutationApproval);
}

export function combineCommandRisks(...risks: CommandRisk[]): CommandRisk {
  return buildRisk(
    [...new Set(risks.flatMap(risk => risk.blockedReasons))],
    risks.some(risk => risk.requiresSubmitApproval),
    risks.some(risk => risk.requiresMutationApproval),
  );
}

interface HashableTaskSpec {
  command: string;
  execution_payload: string;
  remote_workdir: string;
  dependencies: string[];
  step_dependencies: string[];
  input_files: string[];
  expected_outputs: string[];
  preconditions: string[];
  scientific_checks: string[];
  success_criteria: string[];
  approval_points: string[];
  failure_handling: string[];
  failure_policy: string;
  timeout_seconds: number;
}

export function hashTaskSpec(spec: HashableTaskSpec): string {
  const canonical = JSON.stringify({
    command: spec.command,
    execution_payload: spec.execution_payload,
    remote_workdir: spec.remote_workdir,
    dependencies: spec.dependencies,
    step_dependencies: spec.step_dependencies,
    input_files: spec.input_files,
    expected_outputs: spec.expected_outputs,
    preconditions: spec.preconditions,
    scientific_checks: spec.scientific_checks,
    success_criteria: spec.success_criteria,
    approval_points: spec.approval_points,
    failure_handling: spec.failure_handling,
    failure_policy: spec.failure_policy,
    timeout_seconds: spec.timeout_seconds,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
