import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, BookOpen, Bot, Edit3, Filter, Plus, Search, Tag, Trash2, UserRound } from 'lucide-react';
import { experiencesApi, projectsApi, tasksApi } from '../api/client';
import type { Experience, Project, Task } from '../types';

function tagsOf(experience: Experience) {
  try { return JSON.parse(experience.tags || '[]') as string[]; } catch { return []; }
}

function originOf(experience: Experience) {
  if (experience.status === 'confirmed') return 'verified';
  if (experience.source_kind === 'codex' || experience.status === 'candidate') return 'codex';
  return 'manual';
}

export default function ExperiencePage() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [origin, setOrigin] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingExp, setEditingExp] = useState<Experience | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formCategory, setFormCategory] = useState('workflow');
  const [formApplicableScope, setFormApplicableScope] = useState('');
  const [formProjectId, setFormProjectId] = useState('');
  const [formTaskId, setFormTaskId] = useState('');
  const [formTasks, setFormTasks] = useState<Task[]>([]);
  const [formStepId, setFormStepId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { projectsApi.list().then(setProjects).catch(error => setMessage((error as Error).message)); }, []);
  useEffect(() => {
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(next => {
      setTasks(next);
      setTaskId(current => next.some(task => task.id === current) ? current : '');
    }).catch(error => setMessage((error as Error).message));
  }, [projectId]);
  useEffect(() => {
    if (!formProjectId) { setFormTasks([]); setFormTaskId(''); setFormStepId(''); return; }
    tasksApi.list(formProjectId).then(next => {
      setFormTasks(next);
      setFormTaskId(current => next.some(task => task.id === current) ? current : '');
    }).catch(error => setMessage((error as Error).message));
  }, [formProjectId]);

  const load = useCallback(async () => {
    try {
      setExperiences(await experiencesApi.list({ projectId: projectId || undefined, taskId: taskId || undefined, search: search.trim() || undefined }));
      setMessage('');
    } catch (error) { setMessage((error as Error).message); }
  }, [projectId, taskId, search]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

  const filtered = useMemo(() => experiences.filter(experience => !origin || originOf(experience) === origin), [experiences, origin]);
  const selectedFormTask = formTasks.find(task => task.id === formTaskId);

  const resetForm = () => {
    setFormTitle(''); setFormContent(''); setFormTags(''); setFormCategory('workflow'); setFormApplicableScope(''); setFormProjectId(''); setFormTaskId(''); setFormStepId(''); setFormTasks([]);
    setEditingExp(null); setShowForm(false);
  };

  const openEdit = (experience: Experience) => {
    setFormTitle(experience.title); setFormContent(experience.content); setFormTags(tagsOf(experience).join(', '));
    setFormCategory(experience.category ?? 'workflow'); setFormApplicableScope(experience.applicable_scope ?? '');
    setFormProjectId(experience.related_project_id ?? ''); setFormTaskId(experience.related_task_id ?? ''); setFormStepId(experience.related_step_id ?? '');
    setEditingExp(experience); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    const tags = formTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
    const payload = {
      title: formTitle.trim(), content: formContent.trim(), tags,
      related_project_id: formProjectId || undefined,
      related_task_id: formTaskId || undefined,
      related_step_id: formStepId || undefined,
      category: formCategory,
      applicable_scope: formApplicableScope.trim(),
      status: editingExp?.status ?? 'manual',
      source_kind: editingExp?.source_kind ?? 'researcher',
    };
    try {
      if (editingExp) await experiencesApi.update(editingExp.id, payload); else await experiencesApi.create(payload);
      resetForm(); await load();
    } catch (error) { setMessage((error as Error).message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此经验？这不会删除任何计算文件。')) return;
    try { await experiencesApi.delete(id); await load(); } catch (error) { setMessage((error as Error).message); }
  };

  return <div className="flex h-full flex-col bg-[#131320] text-[#e2e2f0]">
    <header className="flex items-end justify-between border-b border-[#2d2d44] px-6 py-5">
      <div><p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#a78bfa]">Reusable research memory</p><h1 className="mt-1 text-xl font-semibold text-white">经验库</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-[#85859c]">沉淀可跨任务复用的踩坑记录、特定配置和成功模式。Codex 在规划与卡壳时检索相关经验，在结果得到验证后自动形成候选经验；证据文件本身归入独立的证据库。</p></div>
      <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1.5 rounded-lg bg-[#8b5cf6] px-3 py-2 text-xs text-white hover:bg-[#7c3aed]"><Plus size={14}/>人工补充经验</button>
    </header>

    <section className="border-b border-[#2d2d44] px-6 py-4"><div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#6b6b80]"><Filter size={13}/>检索同类经验</div><div className="grid gap-3 lg:grid-cols-4">
      <select aria-label="项目筛选" value={projectId} onChange={event => setProjectId(event.target.value)} className="rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm"><option value="">全部项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label="任务筛选" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={!projectId} className="rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm disabled:opacity-45"><option value="">全部任务</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select>
      <select aria-label="来源筛选" value={origin} onChange={event => setOrigin(event.target.value)} className="rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm"><option value="">全部来源</option><option value="codex">Codex 自动沉淀</option><option value="verified">证据确认</option><option value="manual">人工记录</option></select>
      <label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b80]"/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="标题、内容、标签" className="w-full rounded-lg border border-[#383850] bg-[#252536] py-2 pl-9 pr-3 text-sm placeholder-[#4a4a60]"/></label>
    </div></section>
    {message && <div className="mx-6 mt-4 border-l-2 border-[#ef8c87] bg-[#291b24] px-4 py-3 text-xs text-[#f0aaa5]">{message}</div>}

    <main className="flex-1 overflow-y-auto p-6">{filtered.length === 0 ? <div className="py-16 text-center"><BookOpen size={40} className="mx-auto text-[#383850]"/><p className="mt-3 text-sm text-[#6b6b80]">当前筛选下没有经验。</p></div> : <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{filtered.map(experience => {
      const tags = tagsOf(experience); const source = originOf(experience);
      return <article key={experience.id} className="group rounded-xl border border-[#2d2d44] bg-[#1a1a2e] p-4 transition-colors hover:border-[#454561]">
        <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><Bookmark size={14} className="mt-1 shrink-0 text-[#8b5cf6]"/><div><h2 className="font-semibold text-white">{experience.title}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${source === 'verified' ? 'border-[#67c9b5]/30 text-[#9ee0d1]' : source === 'codex' ? 'border-[#8b5cf6]/30 text-[#c4b5fd]' : 'border-[#50506b] text-[#9898b0]'}`}>{source === 'manual' ? <UserRound size={9}/> : <Bot size={9}/>} {source === 'verified' ? '证据确认' : source === 'codex' ? 'Codex 自动沉淀' : '人工记录'}</span>{experience.related_project_id && <span className="text-[#6b6b80]">{experience.related_project_name ?? experience.related_project_id}{experience.related_task_id ? ` / ${experience.related_task_name ?? experience.related_task_id}` : ''}{experience.related_step_id ? ` / ${experience.related_step_id}` : ''}</span>}</div></div></div>
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"><button onClick={() => openEdit(experience)} className="rounded p-1 text-[#6b6b80] hover:bg-[#2d2d44] hover:text-white"><Edit3 size={13}/></button><button onClick={() => handleDelete(experience.id)} className="rounded p-1 text-[#6b6b80] hover:bg-[#2d2d44] hover:text-red-400"><Trash2 size={13}/></button></div>
        </div>
        <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-[#aaaabd]">{experience.content}</p>
        {tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{tags.map(tag => <span key={tag} className="flex items-center gap-1 rounded-full bg-[#2d2d44] px-2 py-0.5 text-[10px] text-[#9898b0]"><Tag size={9}/>{tag}</span>)}</div>}
        <p className="mt-3 text-[10px] text-[#4f4f67]">{experience.category ?? 'workflow'} · {experience.status ?? 'manual'} · 更新于 {new Date(experience.updated_at).toLocaleString('zh-CN')}</p>
      </article>;
    })}</div>}</main>

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={resetForm}><div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#383850] bg-[#1a1a2e] shadow-2xl" onClick={event => event.stopPropagation()}>
      <div className="border-b border-[#2d2d44] px-5 py-4"><h2 className="text-sm font-semibold text-white">{editingExp ? '编辑经验' : '人工补充经验'}</h2><p className="mt-1 text-xs text-[#6b6b80]">写可复用的条件、现象、处理办法和适用边界；原始输出与图请放入证据库。</p></div>
      <div className="space-y-4 p-5">
        <label className="block text-[10px] uppercase tracking-wider text-[#6b6b80]">标题 *<input value={formTitle} onChange={event => setFormTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case text-[#e2e2f0]" placeholder="例如：Wannier 投影窗口过窄时的识别方法"/></label>
        <label className="block text-[10px] uppercase tracking-wider text-[#6b6b80]">内容 *<textarea value={formContent} onChange={event => setFormContent(event.target.value)} rows={7} className="mt-1 w-full resize-none rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case leading-5 text-[#e2e2f0]" placeholder="适用条件、观察到的现象、可靠的处理方式、不能外推的边界……"/></label>
        <label className="block text-[10px] uppercase tracking-wider text-[#6b6b80]">标签<input value={formTags} onChange={event => setFormTags(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case text-[#e2e2f0]" placeholder="软件栈, 物理阶段, 症状, 配置"/></label>
        <div className="grid gap-3 md:grid-cols-2"><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">经验类别<select value={formCategory} onChange={event => setFormCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case"><option value="workflow">流程方法</option><option value="configuration">特定配置</option><option value="troubleshooting">排错经验</option><option value="scientific">科学判断</option><option value="hpc">超算环境</option></select></label><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">适用边界<input value={formApplicableScope} onChange={event => setFormApplicableScope(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case text-[#e2e2f0]" placeholder="适用软件版本、材料类别或前提条件"/></label></div>
        <div className="grid gap-3 md:grid-cols-3"><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">关联项目<select value={formProjectId} onChange={event => { setFormProjectId(event.target.value); setFormTaskId(''); setFormStepId(''); }} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case"><option value="">不关联</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">关联任务<select value={formTaskId} onChange={event => { setFormTaskId(event.target.value); setFormStepId(''); }} disabled={!formProjectId} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case disabled:opacity-45"><option value="">不关联</option>{formTasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">关联骨架步骤<select value={formStepId} onChange={event => setFormStepId(event.target.value)} disabled={!selectedFormTask} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case disabled:opacity-45"><option value="">不关联</option>{selectedFormTask?.workflow.steps.map(step => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label></div>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#2d2d44] px-5 py-4"><button onClick={resetForm} className="rounded-lg px-4 py-2 text-xs text-[#6b6b80] hover:bg-[#2d2d44] hover:text-white">取消</button><button onClick={handleSubmit} className="rounded-lg bg-[#8b5cf6] px-4 py-2 text-xs text-white hover:bg-[#7c3aed]">{editingExp ? '保存修改' : '添加经验'}</button></div>
    </div></div>}
  </div>;
}
