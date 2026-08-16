import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Info, Edit3 } from 'lucide-react';
import { projectsApi, tasksApi, progressApi } from '../api/client';
import { useWorkflowList, useWorkflow, getStageForStepOf } from '../contexts/WorkflowContext';
import Flowchart from '../components/Flowchart';
import StepDetail from '../components/StepDetail';
import ProgressBar from '../components/ProgressBar';
import TemplateEditor from '../components/TemplateEditor';
import type { Project, Task, StepProgress, WorkflowTemplate, WorkflowStep } from '../types';

export default function WorkflowPage() {
  const navigate = useNavigate();
  const workflows = useWorkflowList();
  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<{ task: Task; project: Project }[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [progressList, setProgressList] = useState<StepProgress[]>([]);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  // Set default workflow once loaded
  useEffect(() => {
    if (workflows.length > 0 && !selectedWorkflowId) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [workflows, selectedWorkflowId]);

  // Load all projects and tasks
  const loadData = useCallback(async () => {
    try {
      const projs = await projectsApi.list();
      setProjects(projs);
      const taskLists = await Promise.all(
        projs.map(p => tasksApi.list(p.id).then(ts => ts.map(t => ({ task: t, project: p }))))
      );
      setAllTasks(taskLists.flat());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Load progress when task changes
  const loadProgress = useCallback(async () => {
    if (!selectedTaskId) { setProgressList([]); return; }
    setLoadingProgress(true);
    try {
      const p = await progressApi.list(selectedTaskId);
      setProgressList(p);
      // Sync workflow to match the task's workflow
      const taskEntry = allTasks.find(t => t.task.id === selectedTaskId);
      if (taskEntry) setSelectedWorkflowId(taskEntry.task.workflow_id);
    } catch { /* ignore */ }
    setLoadingProgress(false);
  }, [selectedTaskId, allTasks]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  const templateWorkflow = useWorkflow(selectedWorkflowId);
  const selectedTask = allTasks.find(t => t.task.id === selectedTaskId)?.task;
  const workflow = selectedTask?.workflow ?? templateWorkflow ?? workflows[0];
  if (!workflow) return <div className="flex items-center justify-center h-full text-[#6b6b80]">无工作流</div>;

  // Build progress map
  const progressMap: Record<string, StepProgress> = {};
  progressList.forEach(p => { progressMap[p.step_id] = p; });

  const currentStepProgress = selectedStep ? progressMap[selectedStep.id] : undefined;
  const saveSelectedTaskWorkflow = async (nextWorkflow: WorkflowTemplate) => {
    if (!selectedTask) return;
    const saved = await tasksApi.updateWorkflow(selectedTask.id, nextWorkflow);
    setAllTasks(current => current.map(entry => entry.task.id === selectedTask.id
      ? { ...entry, task: { ...entry.task, workflow: saved } }
      : entry));
    setSelectedStep(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with task selector */}
      <div className="px-5 py-3 border-b border-[#2d2d44] bg-[#1a1a2e]">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold text-white">工作流</h2>
          {/* Task selector */}
          <div className="relative">
            <select
              value={selectedTaskId}
              onChange={e => {
                setSelectedTaskId(e.target.value);
                setSelectedStep(null);
              }}
              className="appearance-none bg-[#252536] border border-[#383850] rounded-lg pl-3 pr-8 py-1.5 text-xs text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6] cursor-pointer min-w-[200px]"
            >
              <option value="">📋 模板预览模式</option>
              {allTasks.map(({ task, project }) => (
                <option key={task.id} value={task.id}>
                  {project.name} / {task.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b6b80] pointer-events-none" />
          </div>
          {/* Template selector in preview mode; selected tasks use their own workflow snapshot. */}
          {!selectedTaskId ? (
            <div className="relative">
              <select
                aria-label="预览工作流模板"
                value={workflow.id}
                onChange={e => {
                  setSelectedWorkflowId(e.target.value);
                  setSelectedStep(null);
                }}
                className="appearance-none bg-[#8b5cf6]/10 text-[#a78bfa] border border-[#8b5cf6]/30 rounded-lg pl-3 pr-8 py-1.5 text-xs focus:outline-none focus:border-[#8b5cf6] cursor-pointer max-w-[420px]"
              >
                {workflows.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b5cf6] pointer-events-none" />
            </div>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6]/80 border border-[#8b5cf6]/20">
              {workflow.name}
            </span>
          )}
          {/* Info hint */}
          {!selectedTaskId && (
            <div className="flex items-center gap-1 text-[10px] text-[#4a4a60]">
              <Info size={11} />
              预览模式：选择任务后可追踪进度
            </div>
          )}
          {selectedTask && (
            <button
              onClick={() => navigate(`/task/${selectedTask.id}`)}
              className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] ml-auto"
            >
              打开任务详情 →
            </button>
          )}
          {/* Edit template button */}
          <button
            onClick={() => setShowEditor(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-lg transition-colors ${
              selectedTaskId
                ? 'text-[#6b6b80] hover:text-white hover:bg-[#2d2d44]'
                : 'text-[#f59e0b] hover:text-[#f59e0b]/80 hover:bg-[#f59e0b]/10 ml-auto'
            }`}
            title={selectedTask ? '编辑当前任务的独立工作流' : '编辑工作流模板'}
          >
            <Edit3 size={11} />
            {selectedTask ? '编辑任务流程' : '编辑模板'}
          </button>
        </div>
        {projects.length === 0 && (
          <p className="text-[10px] text-[#f59e0b]/70 mt-1.5">
            💡 还没有项目，先去「项目仓库」创建项目和任务，然后回来这里选择任务追踪进度
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 border-b border-[#33413f] bg-[#14201e] px-5 py-2 text-[10px] leading-5 text-[#9bc8bd]">
        <Info size={13} className="mt-0.5 shrink-0" />
        <p><strong className="text-[#c8e7df]">工作流只保留核心骨架：</strong>科学阶段、关键软件步骤、必须通过的检查点和完成证据。试跑命令、重试、参数扫描批次、传输和临时诊断由 Codex 记录为 action / event，不应为每次执行细节新增流程节点。</p>
      </div>

      {/* Progress bar (only when a task is selected) */}
      {selectedTaskId && !loadingProgress && (
        <ProgressBar workflow={workflow} progressMap={progressMap} />
      )}

      {/* Flowchart + Detail */}
      <div className="flex flex-1 overflow-hidden">
        <Flowchart
          workflow={workflow}
          progressMap={progressMap}
          onSelectStep={setSelectedStep}
          selectedStepId={selectedStep?.id ?? null}
        />
        {selectedStep && (
          selectedTaskId && selectedTask ? (
            <StepDetail
              step={selectedStep}
              taskId={selectedTaskId}
              workflow={workflow}
              projectId={selectedTask.project_id}
              taskName={selectedTask.name}
              progress={currentStepProgress}
              onClose={() => setSelectedStep(null)}
              onProgressChanged={loadProgress}
            />
          ) : (
            <PreviewStepDetail step={selectedStep} workflow={workflow} onClose={() => setSelectedStep(null)} />
          )
        )}
      </div>

      {/* Template Editor Overlay */}
      {showEditor && (
        selectedTask ? (
          <TemplateEditor
            workflow={workflow}
            mode="task"
            onSave={saveSelectedTaskWorkflow}
            onClose={() => setShowEditor(false)}
          />
        ) : (
          <TemplateEditor
            workflowId={workflow.id}
            onClose={() => setShowEditor(false)}
          />
        )
      )}
    </div>
  );
}

// Read-only step detail for preview mode (no task selected)
function PreviewStepDetail({ step, workflow, onClose }: { step: WorkflowStep; workflow: WorkflowTemplate; onClose: () => void }) {
  const stage = getStageForStepOf(workflow, step.id);

  return (
    <div className="w-96 bg-[#1a1a2e] border-l border-[#2d2d44] flex flex-col flex-shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d2d44]">
        <div className="flex items-center gap-2 min-w-0">
          {stage && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ background: stage.colorBg, color: stage.color, border: `1px solid ${stage.colorBorder}` }}>
              {stage.name}
            </span>
          )}
          <h3 className="text-sm font-semibold text-white truncate">{step.name}</h3>
          {step.optional && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2d2d44] text-[#6b6b80] flex-shrink-0">可选</span>
          )}
        </div>
        <button onClick={onClose} className="text-[#6b6b80] hover:text-white p-1 rounded hover:bg-[#2d2d44] text-xs">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-xs text-[#f59e0b]/70 bg-[#f59e0b]/5 rounded-lg p-2.5 border border-[#f59e0b]/10">
          📋 预览模式 — 选择上方任务后可追踪此步骤的进度和关联文件
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">说明</label>
          <p className="text-sm text-[#9898b0] leading-relaxed bg-[#252536] rounded-lg p-3">{step.description}</p>
        </div>
        {step.inputFiles && step.inputFiles.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">需要准备的文件</label>
            <div className="space-y-1">
              {step.inputFiles.map((f, i) => (
                <div key={i} className="text-xs text-[#9898b0] bg-[#252536] rounded px-3 py-1.5 font-mono">{f}</div>
              ))}
            </div>
          </div>
        )}
        {step.outputFiles && step.outputFiles.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">预期输出文件</label>
            <div className="space-y-1">
              {step.outputFiles.map((f, i) => (
                <div key={i} className="text-xs text-[#22c55e]/70 bg-[#1a2e1a]/30 rounded px-3 py-1.5 font-mono">{f}</div>
              ))}
            </div>
          </div>
        )}
        {step.commands && step.commands.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">Shell 命令</label>
            <div className="space-y-1">
              {step.commands.map((cmd, i) => (
                <div key={i} className="text-xs text-[#e2e2f0] bg-[#0d1117] rounded px-3 py-1.5 font-mono border border-[#2d2d44]">$ {cmd}</div>
              ))}
            </div>
          </div>
        )}
        {step.tips && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">💡 提示</label>
            <p className="text-xs text-[#f59e0b]/80 bg-[#f59e0b]/5 rounded-lg p-3 border border-[#f59e0b]/10 leading-relaxed">{step.tips}</p>
          </div>
        )}
        {step.substeps && step.substeps.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">子步骤</label>
            <div className="space-y-2">
              {step.substeps.map(sub => (
                <div key={sub.id} className="bg-[#252536] rounded-lg p-3">
                  <div className="text-xs font-medium text-white mb-1">{sub.name}</div>
                  <div className="text-xs text-[#9898b0] leading-relaxed">{sub.description}</div>
                  {sub.files && sub.files.length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {sub.files.map((f, i) => (
                        <span key={i} className="text-[10px] text-[#3b82f6]/70 bg-[#3b82f6]/5 px-1.5 py-0.5 rounded font-mono">{f}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
