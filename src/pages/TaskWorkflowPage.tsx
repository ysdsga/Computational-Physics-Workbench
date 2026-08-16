import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit3, Info } from 'lucide-react';
import { tasksApi, progressApi, agentApi } from '../api/client';
import Flowchart from '../components/Flowchart';
import StepDetail from '../components/StepDetail';
import ProgressBar from '../components/ProgressBar';
import TemplateEditor from '../components/TemplateEditor';
import type { AgentContext, Task, StepProgress, WorkflowTemplate, WorkflowStep } from '../types';

export default function TaskWorkflowPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [progressList, setProgressList] = useState<StepProgress[]>([]);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [agentContext, setAgentContext] = useState<AgentContext | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      const [t, context] = await Promise.all([
        tasksApi.get(taskId),
        agentApi.context(taskId).catch(() => null),
      ]);
      setTask(t);
      setAgentContext(context);
      const p = await progressApi.list(taskId);
      setProgressList(p);
    } catch { /* ignore */ }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  if (!task) return <div className="flex items-center justify-center h-full text-[#6b6b80] text-sm">加载中...</div>;

  const workflow = task.workflow;
  if (!workflow) return <div className="flex items-center justify-center h-full text-[#6b6b80] text-sm">未知工作流: {task.workflow_id}</div>;

  const saveTaskWorkflow = async (nextWorkflow: WorkflowTemplate) => {
    const saved = await tasksApi.updateWorkflow(task.id, nextWorkflow);
    setTask(current => current ? { ...current, workflow: saved } : current);
    setSelectedStep(null);
  };

  // Build progress map
  const progressMap: Record<string, StepProgress> = {};
  progressList.forEach(p => { progressMap[p.step_id] = p; });

  const currentStepProgress = selectedStep ? progressMap[selectedStep.id] : undefined;
  const observationMap: Record<string, { actions: number; jobs: number; evidence: number }> = {};
  const observationFor = (stepId: string) => observationMap[stepId] ??= { actions: 0, jobs: 0, evidence: 0 };
  const actionSteps = new Map(agentContext?.recentActions.map(item => [item.id, item.step_id] as const) ?? []);
  agentContext?.recentActions.forEach(item => { if (item.step_id) observationFor(item.step_id).actions += 1; });
  agentContext?.recentJobs.forEach(item => { const stepId = actionSteps.get(item.action_id); if (stepId) observationFor(stepId).jobs += 1; });
  agentContext?.recentEvidenceChecks.forEach(item => { const stepId = actionSteps.get(item.action_id); if (stepId) observationFor(stepId).evidence += 1; });

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
          <button onClick={() => setShowEditor(true)}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa] hover:bg-[#3b82f6]/10 rounded-lg transition-colors">
            <Edit3 size={11} /> 编辑任务流程
          </button>
        </div>
        {task.description && <p className="text-xs text-[#6b6b80] mt-1">{task.description}</p>}
        {agentContext?.run && <div className="mt-2 flex flex-wrap items-center gap-3 border-l-2 border-[#67c9b5] bg-[#13211f] px-3 py-1.5 font-mono text-[9px] text-[#9acdc1]"><span>CODEX RUN {agentContext.run.status}</span><span>STAGE {agentContext.run.current_stage_id ?? '—'}</span><span>{agentContext.recentActions.length} actions</span><span>{agentContext.recentJobs.length} jobs</span><span>{agentContext.recentEvidenceChecks.length} evidence</span><span className="text-[#657570]">只读记录；研究者决定回到 Codex 对话</span></div>}
        <div className="mt-2 flex items-start gap-2 text-[10px] leading-5 text-[#85859c]"><Info size={12} className="mt-0.5 shrink-0 text-[#67c9b5]"/><p>这里是任务的核心科学骨架。具体命令、重试、传输、参数扫描和临时诊断保留在 Codex action / event 中；只有改变关键阶段、检查点或完成证据时才修改工作流。</p></div>
      </div>

      {/* Progress bar */}
      <ProgressBar workflow={workflow} progressMap={progressMap} />

      {/* Flowchart + Detail */}
      <div className="flex flex-1 overflow-hidden">
        <Flowchart
          workflow={workflow}
          progressMap={progressMap}
          observationMap={observationMap}
          onSelectStep={setSelectedStep}
          selectedStepId={selectedStep?.id ?? null}
        />
        {selectedStep && (
          <StepDetail
            step={selectedStep}
            taskId={task.id}
            workflow={workflow}
            projectId={task.project_id}
            taskName={task.name}
            progress={currentStepProgress}
            onClose={() => setSelectedStep(null)}
            onProgressChanged={load}
          />
        )}
      </div>

      {showEditor && (
        <TemplateEditor
          workflow={workflow}
          mode="task"
          onSave={saveTaskWorkflow}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
