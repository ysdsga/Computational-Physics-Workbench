import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Terminal, Save, Server } from 'lucide-react';
import { projectsApi, tasksApi, progressApi } from '../api/client';
import { useWorkflowList } from '../contexts/WorkflowContext';
import HpcWizard from '../components/HpcWizard';
import type { Project, Task, StepProgress, HpcConfig } from '../types';

const DEFAULT_HPC: HpcConfig = {
  host: '',
  user: '',
  remotePath: '',
  moduleQE: 'qe/7.2',
  moduleWannier: 'wannier90/3.1',
  moduleTRIQS: 'triqs/3.3',
  nprocs: '16',
};

export default function HPCPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<{ task: Task; project: Project }[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [progressList, setProgressList] = useState<StepProgress[]>([]);
  const [hpcConfig, setHpcConfig] = useState<HpcConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<HpcConfig>(DEFAULT_HPC);
  const [showConfig, setShowConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const workflows = useWorkflowList();

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

  // When task changes, load progress + project hpc_config
  const loadTaskData = useCallback(async () => {
    if (!selectedTaskId) { setProgressList([]); setHpcConfig(null); return; }
    try {
      const p = await progressApi.list(selectedTaskId);
      setProgressList(p);
      const taskEntry = allTasks.find(t => t.task.id === selectedTaskId);
      if (taskEntry) {
        const project = await projectsApi.get(taskEntry.project.id);
        if (project.hpc_config) {
          const cfg = JSON.parse(project.hpc_config) as HpcConfig;
          setHpcConfig(cfg);
          setConfigDraft(cfg);
        } else {
          setHpcConfig(null);
          setConfigDraft(DEFAULT_HPC);
        }
      }
    } catch { /* ignore */ }
  }, [selectedTaskId, allTasks]);

  useEffect(() => { loadTaskData(); }, [loadTaskData]);

  const selectedTask = allTasks.find(t => t.task.id === selectedTaskId)?.task;
  const selectedProject = allTasks.find(t => t.task.id === selectedTaskId)?.project;
  const workflow = selectedTask?.workflow
    ?? workflows.find(item => item.id === selectedTask?.workflow_id)
    ?? workflows[0];

  const progressMap: Record<string, StepProgress> = {};
  progressList.forEach(p => { progressMap[p.step_id] = p; });

  const handleSaveConfig = async () => {
    if (!selectedProject) return;
    setSavingConfig(true);
    try {
      await projectsApi.update(selectedProject.id, { hpc_config: JSON.stringify(configDraft) });
      setHpcConfig(configDraft);
      setShowConfig(false);
    } catch { /* ignore */ }
    setSavingConfig(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#2d2d44] bg-[#1a1a2e]">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Terminal size={18} className="text-[#3b82f6]" />
            超算提交
          </h2>
          {/* Task selector */}
          <div className="relative">
            <select
              value={selectedTaskId}
              onChange={e => setSelectedTaskId(e.target.value)}
              className="appearance-none bg-[#252536] border border-[#383850] rounded-lg pl-3 pr-8 py-1.5 text-xs text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6] cursor-pointer min-w-[200px]"
            >
              <option value="">选择任务...</option>
              {allTasks.map(({ task, project }) => (
                <option key={task.id} value={task.id}>
                  {project.name} / {task.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b6b80] pointer-events-none" />
          </div>
          {/* Config toggle */}
          {selectedTaskId && (
            <button onClick={() => { setShowConfig(!showConfig); setConfigDraft(hpcConfig ?? DEFAULT_HPC); }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                showConfig ? 'bg-[#2d2d44] text-white' : 'text-[#6b6b80] hover:text-white hover:bg-[#252536]'
              }`}>
              <Server size={13} />
              超算配置
              {hpcConfig ? <span className="text-[#22c55e] text-[9px]">●</span> : <span className="text-[#f59e0b] text-[9px]">○</span>}
            </button>
          )}
        </div>
        {projects.length === 0 && (
          <p className="text-[10px] text-[#f59e0b]/70 mt-1.5">
            还没有项目，先去「项目仓库」创建项目和任务
          </p>
        )}
      </div>

      {/* Config panel (collapsible) */}
      {showConfig && selectedTaskId && (
        <div className="px-5 py-4 border-b border-[#2d2d44] bg-[#252536]">
          <div className="grid grid-cols-2 gap-3 max-w-2xl">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">超算主机</label>
              <input value={configDraft.host} onChange={e => setConfigDraft({ ...configDraft, host: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
                placeholder="login.shanghai-super.com" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">用户名</label>
              <input value={configDraft.user} onChange={e => setConfigDraft({ ...configDraft, user: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
                placeholder="your_username" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">远程工作目录</label>
              <input value={configDraft.remotePath} onChange={e => setConfigDraft({ ...configDraft, remotePath: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]"
                placeholder="/home/username/work" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">QE 模块</label>
              <input value={configDraft.moduleQE} onChange={e => setConfigDraft({ ...configDraft, moduleQE: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]"
                placeholder="qe/7.2" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">Wannier90 模块</label>
              <input value={configDraft.moduleWannier} onChange={e => setConfigDraft({ ...configDraft, moduleWannier: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]"
                placeholder="wannier90/3.1" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">TRIQS 模块</label>
              <input value={configDraft.moduleTRIQS} onChange={e => setConfigDraft({ ...configDraft, moduleTRIQS: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]"
                placeholder="triqs/3.3" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">默认核数</label>
              <input value={configDraft.nprocs} onChange={e => setConfigDraft({ ...configDraft, nprocs: e.target.value })}
                className="w-full bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]"
                placeholder="16" />
            </div>
          </div>
          <div className="mt-3">
            <button onClick={handleSaveConfig} disabled={savingConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb] disabled:opacity-50">
              <Save size={12} /> {savingConfig ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      )}

      {/* Wizard or empty state */}
      {!selectedTaskId ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Terminal size={40} className="mx-auto text-[#383850] mb-3" />
            <p className="text-sm text-[#6b6b80] mb-1">选择任务后查看超算提交向导</p>
            <p className="text-xs text-[#4a4a60]">逐步引导你完成 DFT+DMFT 的超算提交流程</p>
          </div>
        </div>
      ) : workflow ? (
        <HpcWizard
          taskId={selectedTaskId}
          workflow={workflow}
          taskName={selectedTask?.name ?? ''}
          hpcConfig={hpcConfig}
          progressMap={progressMap}
          onProgressChanged={loadTaskData}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-[#6b6b80]">任务工作流不可用</div>
      )}
    </div>
  );
}
