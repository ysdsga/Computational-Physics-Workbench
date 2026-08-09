import { useWorkflow, getStagesOf, getStepsForStageOf, getTotalRequiredStepsOf } from '../contexts/WorkflowContext';
import type { StepProgress } from '../types';

interface Props {
  workflowId: string;
  progressMap: Record<string, StepProgress>;
}

export default function ProgressBar({ workflowId, progressMap }: Props) {
  const workflow = useWorkflow(workflowId);
  const stages = getStagesOf(workflow);

  const stats = stages.map(stage => {
    const steps = getStepsForStageOf(workflow, stage.id);
    const required = steps.filter(s => !s.optional);
    const completed = required.filter(s => progressMap[s.id]?.status === 'completed').length;
    const inProgress = required.filter(s => progressMap[s.id]?.status === 'in_progress').length;
    return { stage, total: required.length, completed, inProgress };
  });

  const totalRequired = getTotalRequiredStepsOf(workflow);
  const totalCompleted = stats.reduce((s, st) => s + st.completed, 0);
  const overallPct = totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : 0;

  return (
    <div className="px-5 py-3 border-b border-[#2d2d44] bg-[#1a1a2e]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-[#9898b0]">总体进度</span>
        <span className="text-xs font-semibold text-white">{overallPct}%</span>
      </div>
      <div className="h-2 bg-[#252536] rounded-full overflow-hidden mb-3">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(overallPct, 1)}%`, background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
      </div>
      <div className="flex gap-3">
        {stats.map(({ stage, total, completed, inProgress }) => {
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          return (
            <div key={stage.id} className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: inProgress > 0 ? stage.color : completed === total ? stage.color : '#383850' }} />
                  <span className="text-[10px] text-[#6b6b80] truncate">{stage.name}</span>
                </div>
                <span className="text-[10px] text-[#9898b0] flex-shrink-0 ml-1">{completed}/{total}</span>
              </div>
              <div className="h-1 bg-[#252536] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(pct, total > 0 ? 5 : 0)}%`, backgroundColor: stage.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
