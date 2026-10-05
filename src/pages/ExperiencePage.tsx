import { t, getLocale } from '../i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, BookOpen, Bot, Edit3, Filter, Plus, Search, Tag, Trash2, UserRound } from 'lucide-react';
import { localizeWorkflow } from '../data/workflow-localization';
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
    if (!confirm(t("确定删除此经验？这不会删除任何计算文件。", "Delete this experience? No calculation files will be deleted."))) return;
    try { await experiencesApi.delete(id); await load(); } catch (error) { setMessage((error as Error).message); }
  };

  return <div className="flex h-full flex-col bg-[#131320] text-[#e2e2f0]">
    <header className="flex items-end justify-between border-b border-[#2d2d44] px-6 py-5">
      <div><p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#a78bfa]">Reusable research memory</p><h1 className="mt-1 text-xl font-semibold text-white">{t("经验库", "Experience library")}</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-[#85859c]">{t("沉淀可跨任务复用的踩坑记录、特定配置和成功模式。Codex 在规划与卡壳时检索相关经验，在结果得到验证后自动形成候选经验；证据文件本身归入独立的证据库。", "Keep reusable lessons, configurations, and successful approaches across tasks. Codex searches relevant experience while planning or troubleshooting and creates candidate entries after results are validated. Evidence files belong in the separate evidence library.")}</p></div>
      <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1.5 rounded-lg bg-[#8b5cf6] px-3 py-2 text-xs text-white hover:bg-[#7c3aed]"><Plus size={14}/>{t("人工补充经验", "Add experience manually")}</button>
    </header>

    <section className="border-b border-[#2d2d44] px-6 py-4"><div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#6b6b80]"><Filter size={13}/>{t("检索同类经验", "Find related experience")}</div><div className="grid gap-3 lg:grid-cols-4">
      <select aria-label={t("项目筛选", "Filter by project")} value={projectId} onChange={event => setProjectId(event.target.value)} className="rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm"><option value="">{t("全部项目", "All projects")}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label={t("任务筛选", "Filter by task")} value={taskId} onChange={event => setTaskId(event.target.value)} disabled={!projectId} className="rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm disabled:opacity-45"><option value="">{t("全部任务", "All tasks")}</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select>
      <select aria-label={t("来源筛选", "Filter by source")} value={origin} onChange={event => setOrigin(event.target.value)} className="rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm"><option value="">{t("全部来源", "All sources")}</option><option value="codex">{t("Codex 自动沉淀", "Recorded by Codex")}</option><option value="verified">{t("证据确认", "Evidence confirmed")}</option><option value="manual">{t("人工记录", "Manual entry")}</option></select>
      <label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b80]"/><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("标题、内容、标签", "Title, content, tags")} className="w-full rounded-lg border border-[#383850] bg-[#252536] py-2 pl-9 pr-3 text-sm placeholder-[#4a4a60]"/></label>
    </div></section>
    {message && <div className="mx-6 mt-4 border-l-2 border-[#ef8c87] bg-[#291b24] px-4 py-3 text-xs text-[#f0aaa5]">{message}</div>}

    <main className="flex-1 overflow-y-auto p-6">{filtered.length === 0 ? <div className="py-16 text-center"><BookOpen size={40} className="mx-auto text-[#383850]"/><p className="mt-3 text-sm text-[#6b6b80]">{t("当前筛选下没有经验。", "No experience matches these filters.")}</p></div> : <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{filtered.map(experience => {
      const tags = tagsOf(experience); const source = originOf(experience);
      return <article key={experience.id} className="group rounded-xl border border-[#2d2d44] bg-[#1a1a2e] p-4 transition-colors hover:border-[#454561]">
        <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><Bookmark size={14} className="mt-1 shrink-0 text-[#8b5cf6]"/><div><h2 className="font-semibold text-white">{experience.title}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${source === 'verified' ? 'border-[#67c9b5]/30 text-[#9ee0d1]' : source === 'codex' ? 'border-[#8b5cf6]/30 text-[#c4b5fd]' : 'border-[#50506b] text-[#9898b0]'}`}>{source === 'manual' ? <UserRound size={9}/> : <Bot size={9}/>} {source === 'verified' ? t("证据确认", "Evidence confirmed") : source === 'codex' ? t("Codex 自动沉淀", "Recorded by Codex") : t("人工记录", "Manual entry")}</span>{experience.related_project_id && <span className="text-[#6b6b80]">{experience.related_project_name ?? experience.related_project_id}{experience.related_task_id ? ` / ${experience.related_task_name ?? experience.related_task_id}` : ''}{experience.related_step_id ? ` / ${experience.related_step_id}` : ''}</span>}</div></div></div>
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"><button aria-label={t("编辑经验", "Edit experience")} onClick={() => openEdit(experience)} className="rounded p-1 text-[#6b6b80] hover:bg-[#2d2d44] hover:text-white"><Edit3 size={13}/></button><button aria-label={t("删除经验", "Delete experience")} onClick={() => handleDelete(experience.id)} className="rounded p-1 text-[#6b6b80] hover:bg-[#2d2d44] hover:text-red-400"><Trash2 size={13}/></button></div>
        </div>
        <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-[#aaaabd]">{experience.content}</p>
        {tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{tags.map(tag => <span key={tag} className="flex items-center gap-1 rounded-full bg-[#2d2d44] px-2 py-0.5 text-[10px] text-[#9898b0]"><Tag size={9}/>{tag}</span>)}</div>}
        <p className="mt-3 text-[10px] text-[#4f4f67]">{experience.category ?? 'workflow'} · {experience.status ?? 'manual'} {t("· 更新于", "· Updated")} {new Date(experience.updated_at).toLocaleString(getLocale())}</p>
      </article>;
    })}</div>}</main>

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={resetForm}><div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#383850] bg-[#1a1a2e] shadow-2xl" onClick={event => event.stopPropagation()}>
      <div className="border-b border-[#2d2d44] px-5 py-4"><h2 className="text-sm font-semibold text-white">{editingExp ? t("编辑经验", "Edit experience") : t("人工补充经验", "Add experience manually")}</h2><p className="mt-1 text-xs text-[#6b6b80]">{t("写可复用的条件、现象、处理办法和适用边界；原始输出与图请放入证据库。", "Record reusable conditions, observations, remedies, and applicability limits. Put raw outputs and plots in the evidence library.")}</p></div>
      <div className="space-y-4 p-5">
        <label className="block text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("标题 *", "Title *")}<input value={formTitle} onChange={event => setFormTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case text-[#e2e2f0]" placeholder={t("例如：Wannier 投影窗口过窄时的识别方法", "Example: Recognizing a Wannier projection window that is too narrow")}/></label>
        <label className="block text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("内容 *", "Content *")}<textarea value={formContent} onChange={event => setFormContent(event.target.value)} rows={7} className="mt-1 w-full resize-none rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case leading-5 text-[#e2e2f0]" placeholder={t("适用条件、观察到的现象、可靠的处理方式、不能外推的边界……", "Applicable conditions, observed symptoms, reliable remedies, and limits on generalization…")}/></label>
        <label className="block text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("标签", "Tags")}<input value={formTags} onChange={event => setFormTags(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case text-[#e2e2f0]" placeholder={t("软件栈, 物理阶段, 症状, 配置", "Software stack, physics stage, symptom, configuration")}/></label>
        <div className="grid gap-3 md:grid-cols-2"><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("经验类别", "Experience category")}<select value={formCategory} onChange={event => setFormCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case"><option value="workflow">{t("流程方法", "Workflow methods")}</option><option value="configuration">{t("特定配置", "Specific configuration")}</option><option value="troubleshooting">{t("排错经验", "Troubleshooting")}</option><option value="scientific">{t("科学判断", "Scientific assessment")}</option><option value="hpc">{t("超算环境", "HPC environment")}</option></select></label><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("适用边界", "Applicability limits")}<input value={formApplicableScope} onChange={event => setFormApplicableScope(event.target.value)} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case text-[#e2e2f0]" placeholder={t("适用软件版本、材料类别或前提条件", "Applicable software versions, material classes, or prerequisites")}/></label></div>
        <div className="grid gap-3 md:grid-cols-3"><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("关联项目", "Related project")}<select value={formProjectId} onChange={event => { setFormProjectId(event.target.value); setFormTaskId(''); setFormStepId(''); }} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case"><option value="">{t("不关联", "None")}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("关联任务", "Related task")}<select value={formTaskId} onChange={event => { setFormTaskId(event.target.value); setFormStepId(''); }} disabled={!formProjectId} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case disabled:opacity-45"><option value="">{t("不关联", "None")}</option>{formTasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label><label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">{t("关联骨架步骤", "Related core workflow step")}<select value={formStepId} onChange={event => setFormStepId(event.target.value)} disabled={!selectedFormTask} className="mt-1 w-full rounded-lg border border-[#383850] bg-[#252536] px-3 py-2 text-sm normal-case disabled:opacity-45"><option value="">{t("不关联", "None")}</option>{(selectedFormTask ? localizeWorkflow(selectedFormTask.workflow, getLocale()).steps : []).map(step => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label></div>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#2d2d44] px-5 py-4"><button onClick={resetForm} className="rounded-lg px-4 py-2 text-xs text-[#6b6b80] hover:bg-[#2d2d44] hover:text-white">{t("取消", "Cancel")}</button><button onClick={handleSubmit} className="rounded-lg bg-[#8b5cf6] px-4 py-2 text-xs text-white hover:bg-[#7c3aed]">{editingExp ? t("保存修改", "Save changes") : t("添加经验", "Add experience")}</button></div>
    </div></div>}
  </div>;
}
