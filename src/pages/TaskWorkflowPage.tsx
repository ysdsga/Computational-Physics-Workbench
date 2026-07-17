import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { tasksApi, progressApi } from '../api/client';
import { useWorkflow } from '../contexts/WorkflowContext';
import Flowchart from '../components/Flowchart';
import StepDetail from '../components/StepDetail';
import ProgressBar from '../components/ProgressBar';
import type { Task, StepProgress, WorkflowStep } from '../types';

export default function TaskWorkflowPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [progressList, setProgressList] = useState<StepProgress[]>([]);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      const t = await tasksApi.get(taskId);
      setTask(t);
      const p = await progressApi.list(taskId);
      setProgressList(p);
    } catch { /* ignore */ }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const workflow = useWorkflow(task?.workflow_id ?? '');

  if (!task) return <div className="flex items-center justify-center h-full text-[#6b6b80] text-sm">加载中...</div>;

  if (!workflow) return <div className="flex items-center justify-center h-full text-[#6b6b80] text-sm">未知工作流: {task.workflow_id}</div>;

  // Build progress map
  const progressMap: Record<string, StepProgress> = {};
  progressList.forEach(p => { progressMap[p.step_id] = p; });

  const currentStepProgress = selectedStep ? progressMap[selectedStep.id] : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#2d2d44]">
        <button onClick={() => navigate(`/project/${task.project_id}`)}
          className="flex items-center gap-1 text-xs text-[#6b6b80] hover:text-white mb-1.5">
          <ArrowLeft size={12} /> 返回项目
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">{task.name}</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6]/80 border border-[#8b5cf6]/20">
            {workflow.name}
          </span>
        </div>
        {task.description && <p className="text-xs text-[#6b6b80] mt-1">{task.description}</p>}
      </div>

      {/* Progress bar */}
      <ProgressBar workflowId={workflow.id} progressMap={progressMap} />

      {/* Flowchart + Detail */}
      <div className="flex flex-1 overflow-hidden">
        <Flowchart
          workflowId={workflow.id}
          progressMap={progressMap}
          onSelectStep={setSelectedStep}
          selectedStepId={selectedStep?.id ?? null}
        />
        {selectedStep && (
          <StepDetail
            step={selectedStep}
            taskId={task.id}
            workflowId={workflow.id}
            projectId={task.project_id}
            taskFolderName={task.folder_name || task.name}
            progress={currentStepProgress}
            onClose={() => setSelectedStep(null)}
            onProgressChanged={load}
          />
        )}
      </div>
    </div>
  );
}
