import type { WorkflowStep } from '../types';

interface Props {
  step: WorkflowStep;
}

const sections = [
  { key: 'dependsOn', label: '前置步骤', color: 'text-[#60a5fa]', mono: true },
  { key: 'preconditions', label: '前置条件', color: 'text-[#cbd5e1]' },
  { key: 'scientificChecks', label: '科学检查项', color: 'text-[#22d3ee]' },
  { key: 'successCriteria', label: '成功判据', color: 'text-[#4ade80]' },
  { key: 'failureHandling', label: '失败处理', color: 'text-[#fb923c]' },
  { key: 'approvalPoints', label: '人工审批点', color: 'text-[#f87171]' },
] as const;

export default function ScientificContract({ step }: Props) {
  const visible = sections.filter(section => (step[section.key]?.length ?? 0) > 0);
  if (!visible.length) return null;

  return (
    <div>
      <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-[#6b6b80]">科学执行契约</label>
      <div className="space-y-2 rounded-lg border border-[#383850] bg-[#111827]/60 p-3">
        {visible.map(section => (
          <div key={section.key}>
            <div className={`mb-1 text-[10px] font-medium ${section.color}`}>{section.label}</div>
            <ul className={`space-y-0.5 text-[10px] leading-relaxed text-[#9898b0] ${'mono' in section && section.mono ? 'font-mono' : ''}`}>
              {(step[section.key] ?? []).map((item, index) => (
                <li key={`${section.key}-${index}`} className="flex gap-1.5">
                  <span className="text-[#4a4a60]">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
