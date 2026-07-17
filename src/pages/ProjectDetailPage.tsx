import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit3, Play, FolderOpen } from 'lucide-react';
import { projectsApi, tasksApi } from '../api/client';
import { useWorkflowList } from '../contexts/WorkflowContext';
import type { Project, Task } from '../types';
import FileBrowser from '../components/FileBrowser';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<'tasks' | 'files'>('tasks');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskWorkflow, setTaskWorkflow] = useState('');
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
      const [p, t] = await Promise.all([
        projectsApi.get(projectId),
        tasksApi.list(projectId),
      ]);
      setProject(p);
      setTasks(t);
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetTaskForm = () => {
    setTaskName(''); setTaskDesc(''); setTaskWorkflow(workflows[0]?.id ?? '');
    setEditingTask(null); setShowTaskForm(false);
  };

  const handleCreateTask = async () => {
    if (!projectId || !taskName.trim()) return;
    if (editingTask) {
      await tasksApi.update(editingTask.id, { name: taskName.trim(), description: taskDesc.trim() });
    } else {
      await tasksApi.create(projectId, { name: taskName.trim(), description: taskDesc.trim(), workflow_id: taskWorkflow });
    }
    resetTaskForm(); load();
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm('确定删除此任务？所有进度数据将一并删除。')) return;
    await tasksApi.delete(id); load();
  };

  if (!project) return <div className="flex items-center justify-center h-full text-[#6b6b80] text-sm">加载中...</div>;

  const taskStatusColors: Record<string, string> = {
    active: '#22c55e', paused: '#f59e0b', completed: '#3b82f6', archived: '#6b6b80',
  };
  const taskStatusLabels: Record<string, string> = {
    active: '进行中', paused: '已暂停', completed: '已完成', archived: '已归档',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#2d2d44]">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-xs text-[#6b6b80] hover:text-white mb-2">
          <ArrowLeft size={12} /> 返回项目列表
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
          <Play size={13} /> 任务 ({tasks.length})
        </button>
        <button onClick={() => setTab('files')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === 'files' ? 'bg-[#2d2d44] text-white' : 'text-[#6b6b80] hover:text-white hover:bg-[#252536]'}`}>
          <FolderOpen size={13} /> 文件仓库
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'tasks' ? (
          <div className="h-full overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[#9898b0]">计算任务</h3>
              <button onClick={() => { resetTaskForm(); setShowTaskForm(true); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
                <Plus size={14} /> 新建任务
              </button>
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-12">
                <Play size={36} className="mx-auto text-[#383850] mb-3" />
                <p className="text-sm text-[#6b6b80]">暂无任务，创建一个开始计算</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map(t => {
                  const wf = workflows.find(w => w.id === t.workflow_id);
                  return (
                    <div key={t.id} className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4 hover:border-[#383850] transition-colors group">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/task/${t.id}`)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: taskStatusColors[t.status] }} />
                            <h4 className="text-sm font-medium text-white truncate">{t.name}</h4>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            {wf && <span className="text-[10px] text-[#8b5cf6]/70 bg-[#8b5cf6]/5 px-1.5 py-0.5 rounded">{wf.name}</span>}
                            <span className="text-[10px] text-[#6b6b80]">{taskStatusLabels[t.status]}</span>
                            <span className="text-[10px] text-[#4a4a60]">{new Date(t.updated_at).toLocaleString('zh-CN')}</span>
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingTask(t); setTaskName(t.name); setTaskDesc(t.description); setShowTaskForm(true); }}
                            className="p-1 text-[#6b6b80] hover:text-white rounded hover:bg-[#2d2d44]"><Edit3 size={13} /></button>
                          <button onClick={() => handleDeleteTask(t.id)}
                            className="p-1 text-[#6b6b80] hover:text-red-400 rounded hover:bg-[#2d2d44]"><Trash2 size={13} /></button>
                        </div>
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
              <h3 className="text-sm font-semibold text-white">{editingTask ? '编辑任务' : '新建任务'}</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">任务名称 *</label>
                <input value={taskName} onChange={e => setTaskName(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
                  placeholder="例如：V2O3 顺磁性 one-shot DMFT" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">描述</label>
                <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={2}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] resize-none focus:outline-none focus:border-[#3b82f6]"
                  placeholder="任务简要描述..." />
              </div>
              {!editingTask && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">工作流模板</label>
                  <select value={taskWorkflow} onChange={e => setTaskWorkflow(e.target.value)}
                    className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]">
                    {workflows.map(w => <option key={w.id} value={w.id}>{w.name} — {w.description}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[#2d2d44] flex justify-end gap-2">
              <button onClick={resetTaskForm} className="px-4 py-2 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
              <button onClick={handleCreateTask} className="px-4 py-2 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">{editingTask ? '保存修改' : '创建任务'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
