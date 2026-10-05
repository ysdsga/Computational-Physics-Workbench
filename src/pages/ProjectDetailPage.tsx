import { t, getLocale, useLocalizedMessage } from '../i18n';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit3, Play, FolderOpen, FileText, ChevronRight } from 'lucide-react';
import { projectsApi, tasksApi, researchPlansApi } from '../api/client';
import { useWorkflowList } from '../contexts/WorkflowContext';
import type { Project, Task, ResearchPlan, ResearchPlanStatus } from '../types';
import { localizeWorkflow } from '../data/workflow-localization';
import FileBrowser from '../components/FileBrowser';

const PLAN_STATUS_COLOR: Record<ResearchPlanStatus, string> = {
  draft: '#6b6b80', active: '#22c55e', completed: '#3b82f6', archived: '#f59e0b',
};

export default function ProjectDetailPage() {
  const PLAN_STATUS_LABEL: Record<ResearchPlanStatus, string> = {
    draft: t("草稿", "Draft"), active: t("进行中", "Active"), completed: t("已完成", "Completed"), archived: t("已归档", "Archived"),
  };
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<ResearchPlan[]>([]);
  const [tab, setTab] = useState<'tasks' | 'plans' | 'files'>('tasks');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskWorkflow, setTaskWorkflow] = useState('');
  const [taskFormError, setTaskFormError] = useLocalizedMessage();
  const [taskSaving, setTaskSaving] = useState(false);
  const workflows = useWorkflowList();

  // Set default workflow once workflows are loaded
  useEffect(() => {
    if (workflows.length > 0 && !taskWorkflow) {
      setTaskWorkflow(workflows[0].id);
    }
  }, [workflows, taskWorkflow]);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [p, t, ps] = await Promise.all([
        projectsApi.get(projectId),
        tasksApi.list(projectId),
        researchPlansApi.list({ projectId }),
      ]);
      setProject(p);
      setTasks(t);
      setPlans(ps);
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetTaskForm = () => {
    setTaskName(''); setTaskDesc(''); setTaskWorkflow(workflows[0]?.id ?? '');
    setTaskFormError(''); setTaskSaving(false);
    setEditingTask(null); setShowTaskForm(false);
  };

  const handleCreateTask = async () => {
    if (!projectId) {
      setTaskFormError(() => t("项目信息缺失，请刷新页面后重试。", "Project information is missing. Refresh the page and try again."));
      return;
    }
    const name = taskName.trim();
    if (!name) {
      setTaskFormError(() => t("请输入任务名称。", "Enter a task name."));
      return;
    }
    if (!editingTask && !taskWorkflow) {
      setTaskFormError(() => t("工作流模板尚未加载，请稍后重试。", "Workflow templates have not loaded yet. Try again shortly."));
      return;
    }

    setTaskFormError('');
    setTaskSaving(true);
    try {
      if (editingTask) {
        await tasksApi.update(editingTask.id, { name, description: taskDesc.trim() });
      } else {
        await tasksApi.create(projectId, { name, description: taskDesc.trim(), workflow_id: taskWorkflow });
      }
      resetTaskForm();
      await load();
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      setTaskFormError(() => `${editingTask ? t("保存失败", "Save failed") : t("创建失败", "Creation failed")}${t("：", ": ")}${detail ?? t("未知错误", "Unknown error")}`);
    } finally {
      setTaskSaving(false);
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm(t("确定删除此任务？所有进度数据将一并删除。", "Delete this task? All its progress data will also be deleted."))) return;
    try { await tasksApi.delete(id); }
    catch (error) {
      const item = error as Error & { code?: string };
      if (item.code !== 'RUN_HISTORY_PROTECTED') return alert(t(`删除失败：${item.message}`, `Deletion failed: ${item.message}`));
      if (!confirm(t("该任务已有研究运行记录，不能物理删除。是否改为归档？", "This task has research run records and cannot be permanently deleted. Archive it instead?"))) return;
      await tasksApi.update(id, { status: 'archived' });
    }
    load();
  };

  if (!project) return <div className="flex items-center justify-center h-full text-[#6b6b80] text-sm">{t("加载中...", "Loading...")}</div>;

  const taskStatusColors: Record<string, string> = {
    active: '#22c55e', paused: '#f59e0b', completed: '#3b82f6', archived: '#6b6b80',
  };
  const taskStatusLabels: Record<string, string> = {
    active: t("进行中", "Active"), paused: t("已暂停", "Paused"), completed: t("已完成", "Completed"), archived: t("已归档", "Archived"),
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#2d2d44]">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-xs text-[#6b6b80] hover:text-white mb-2">
          <ArrowLeft size={12} /> {t("返回项目列表", "Back to projects")}
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">{project.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              {project.material && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3b82f6]/10 text-[#3b82f6]/80 border border-[#3b82f6]/20">{project.material}</span>}
              {project.working_dir && <span className="text-[10px] text-[#6b6b80] font-mono">{project.working_dir}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-2 border-b border-[#2d2d44]">
        <button onClick={() => setTab('tasks')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === 'tasks' ? 'bg-[#2d2d44] text-white' : 'text-[#6b6b80] hover:text-white hover:bg-[#252536]'}`}>
          <Play size={13} /> {t("任务 (", "Tasks (")}{tasks.length})
        </button>
        <button onClick={() => setTab('plans')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === 'plans' ? 'bg-[#2d2d44] text-white' : 'text-[#6b6b80] hover:text-white hover:bg-[#252536]'}`}>
          <FileText size={13} /> {t("研究方案 (", "Research plans (")}{plans.length})
        </button>
        <button onClick={() => setTab('files')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === 'files' ? 'bg-[#2d2d44] text-white' : 'text-[#6b6b80] hover:text-white hover:bg-[#252536]'}`}>
          <FolderOpen size={13} /> {t("文件仓库", "Project files")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'tasks' ? (
          <div className="h-full overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[#9898b0]">{t("计算任务", "Calculation tasks")}</h3>
              <button onClick={() => { resetTaskForm(); setShowTaskForm(true); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
                <Plus size={14} /> {t("新建任务", "New task")}
              </button>
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-12">
                <Play size={36} className="mx-auto text-[#383850] mb-3" />
                <p className="text-sm text-[#6b6b80]">{t("暂无任务，创建一个开始计算", "No tasks yet. Create one to start a calculation.")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map(task => {
                  const wf = task.workflow ?? workflows.find(w => w.id === task.workflow_id);
                  return (
                    <div key={task.id} className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4 hover:border-[#383850] transition-colors group">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/task/${task.id}`)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: taskStatusColors[task.status] }} />
                            <h4 className="text-sm font-medium text-white truncate">{task.name}</h4>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            {wf && <span className="text-[10px] text-[#8b5cf6]/70 bg-[#8b5cf6]/5 px-1.5 py-0.5 rounded">{localizeWorkflow(wf, getLocale()).name}</span>}
                            <span className="text-[10px] text-[#6b6b80]">{taskStatusLabels[task.status]}</span>
                            <span className="text-[10px] text-[#4a4a60]">{new Date(task.updated_at).toLocaleString(getLocale())}</span>
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button aria-label={t("编辑任务", "Edit task")} onClick={() => { setEditingTask(task); setTaskName(task.name); setTaskDesc(task.description); setShowTaskForm(true); }}
                            className="p-1 text-[#6b6b80] hover:text-white rounded hover:bg-[#2d2d44]"><Edit3 size={13} /></button>
                          <button aria-label={t("删除任务", "Delete task")} onClick={() => handleDeleteTask(task.id)}
                            className="p-1 text-[#6b6b80] hover:text-red-400 rounded hover:bg-[#2d2d44]"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : tab === 'plans' ? (
          <div className="h-full overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[#9898b0]">{t("研究方案", "Research plans")}</h3>
              <button onClick={() => navigate('/research-plans')}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#8b5cf6] text-white text-xs rounded-lg hover:bg-[#7c3aed]">
                <Plus size={14} /> {t("管理研究方案", "Manage research plans")}
              </button>
            </div>

            {plans.length === 0 ? (
              <div className="text-center py-12">
                <FileText size={36} className="mx-auto text-[#383850] mb-3" />
                <p className="text-sm text-[#6b6b80]">{t("该项目暂无研究方案", "This project has no research plans yet")}</p>
                <p className="text-xs text-[#4a4a60] mt-1">{t("前往\"研究方案\"页面导入或创建，并关联到本项目", "Create or import a plan on the Research plans page and link it to this project")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {plans.map(p => {
                  const color = PLAN_STATUS_COLOR[p.status];
                  return (
                    <div key={p.id}
                      onClick={() => navigate(`/research-plans?id=${p.id}`)}
                      className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4 hover:border-[#383850] transition-colors cursor-pointer group">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ color, background: `${color}1a`, border: `1px solid ${color}55` }}>
                              {PLAN_STATUS_LABEL[p.status]}
                            </span>
                            <h4 className="text-sm font-medium text-white truncate">{p.title}</h4>
                          </div>
                          <div className="text-[10px] text-[#6b6b80] font-mono ml-1">{p.file_name}</div>
                          <div className="text-[10px] text-[#4a4a60] mt-1 ml-1">{t("更新于", "Updated")} {new Date(p.updated_at).toLocaleString(getLocale())}</div>
                        </div>
                        <ChevronRight size={14} className="text-[#6b6b80] group-hover:text-white flex-shrink-0 mt-1" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <FileBrowser projectId={project.id} workingDir={project.working_dir} />
        )}
      </div>

      {/* Task Form Modal */}
      {showTaskForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={resetTaskForm}>
          <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl w-[440px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2d2d44]">
              <h3 className="text-sm font-semibold text-white">{editingTask ? t("编辑任务", "Edit task") : t("新建任务", "New task")}</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">{t("任务名称 *", "Task name *")}</label>
                <input value={taskName} onChange={e => { setTaskName(e.target.value); setTaskFormError(''); }}
                  aria-invalid={Boolean(taskFormError && !taskName.trim())}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
                  placeholder={t("例如：V2O3 顺磁性 one-shot DMFT", "Example: V2O3 paramagnetic one-shot DMFT")} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">{t("描述", "Description")}</label>
                <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={2}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] resize-none focus:outline-none focus:border-[#3b82f6]"
                  placeholder={t("任务简要描述...", "Brief task description...")} />
              </div>
              {!editingTask && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">{t("工作流模板", "Workflow template")}</label>
                  <select value={taskWorkflow} aria-label={t("工作流模板", "Workflow template")} onChange={e => { setTaskWorkflow(e.target.value); setTaskFormError(''); }}
                    className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]">
                    {workflows.map(w => <option key={w.id} value={w.id}>{localizeWorkflow(w, getLocale()).name} — {localizeWorkflow(w, getLocale()).description}</option>)}
                  </select>
                </div>
              )}
              {taskFormError && (
                <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {taskFormError}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[#2d2d44] flex justify-end gap-2">
              <button onClick={resetTaskForm} disabled={taskSaving} className="px-4 py-2 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44] disabled:cursor-not-allowed disabled:opacity-50">{t("取消", "Cancel")}</button>
              <button onClick={handleCreateTask} disabled={taskSaving} className="px-4 py-2 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50">
                {taskSaving ? (editingTask ? t("保存中...", "Saving...") : t("创建中...", "Creating...")) : (editingTask ? t("保存修改", "Save changes") : t("创建任务", "Create task"))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
