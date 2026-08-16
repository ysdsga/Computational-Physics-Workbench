import { useCallback, useEffect, useState } from 'react';
import { Bot, Clock3, MessageSquareWarning, RefreshCw, UserRound } from 'lucide-react';
import { agentApi, projectsApi, tasksApi } from '../api/client';
import type { PendingItem, Project, Task } from '../types';

export default function ReviewCenterPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [status, setStatus] = useState('open');
  const [audience, setAudience] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { projectsApi.list().then(setProjects).catch(error => setMessage((error as Error).message)); }, []);
  useEffect(() => {
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(setTasks).catch(error => setMessage((error as Error).message));
  }, [projectId]);
  const refresh = useCallback(async () => {
    try {
      setItems(await agentApi.pendingItems({ projectId: projectId || undefined, taskId: taskId || undefined, audience: audience || undefined, status: status || undefined }));
      setMessage('');
    } catch (error) { setMessage((error as Error).message); }
  }, [projectId, taskId, audience, status]);
  useEffect(() => { void refresh(); }, [refresh]);

  return <div className="h-full overflow-y-auto bg-[#0d1214] p-8 text-[#e9f0ed]">
    <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="font-mono text-[10px] uppercase tracking-[.28em] text-[#dfb26a]">shared attention queue</p><h1 className="mt-1 text-2xl font-semibold">待沟通事项</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#92a29e]">统一显示 Codex 自己需要继续处理的问题和真正需要研究者决定的材料事项。页面负责筛选和观察；决定仍在 Codex 对话中形成并由 CLI 记录。</p></div><button onClick={refresh} className="inline-flex items-center gap-2 border border-[#40504d] bg-[#182123] px-4 py-2 text-sm"><RefreshCw size={15}/>刷新</button></header>
    <section className="mt-6 grid gap-3 border border-[#293534] bg-[#131a1c] p-4 md:grid-cols-4">
      <label className="text-xs text-[#91a19d]">项目<select value={projectId} onChange={event => { setProjectId(event.target.value); setTaskId(''); }} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2"><option value="">全部项目</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-xs text-[#91a19d]">任务<select value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2"><option value="">全部任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-xs text-[#91a19d]">状态<select value={status} onChange={event => setStatus(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2"><option value="">全部状态</option><option value="open">待处理</option><option value="resolved">已解决</option><option value="dismissed">已忽略</option></select></label>
      <label className="text-xs text-[#91a19d]">处理者<select value={audience} onChange={event => setAudience(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2"><option value="">全部</option><option value="researcher">研究者</option><option value="codex">Codex</option></select></label>
    </section>
    {message && <div className="mt-4 border-l-2 border-[#d87e77] bg-[#241716] p-3 text-sm text-[#e9a29c]">{message}</div>}
    <div className="mt-5 grid gap-4 xl:grid-cols-2">{items.map(item => <article key={item.id} className={`border p-5 ${item.status === 'open' ? 'border-[#5f482d] bg-[#211b13]' : 'border-[#293534] bg-[#131a1c]'}`}>
      <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#dfb26a]">{item.audience === 'researcher' ? <UserRound size={13}/> : <Bot size={13}/>} {item.audience} · {item.kind}</div><h2 className="mt-2 font-medium">{item.title}</h2></div><span className="border border-current px-2 py-1 font-mono text-[10px] uppercase">{item.status}</span></div>
      <div className="mt-3 text-xs text-[#aebbb7]">{item.project_name ?? '—'} / {item.task_name ?? '—'} / {item.stage_id ?? 'all stages'}</div>
      <pre className="mt-3 max-h-48 overflow-auto border border-[#364340] bg-black/20 p-3 text-xs leading-5 text-[#c5d0cd]">{JSON.stringify(item.detail, null, 2)}</pre>
      {item.status === 'open' ? <div className="mt-3 flex gap-2 text-xs text-[#e8d0aa]"><Clock3 size={14}/>{item.audience === 'researcher' ? '等待在 Codex 对话中讨论并确认。' : '等待 Codex 自主诊断、修复或恢复。'}</div> : <div className="mt-3 text-xs text-[#9ee0d1]">处理结果：{JSON.stringify(item.resolution)}</div>}
    </article>)}{items.length === 0 && <div className="border border-dashed border-[#364340] p-12 text-center text-sm text-[#657570] xl:col-span-2"><MessageSquareWarning size={32} className="mx-auto mb-3"/>当前筛选下没有待沟通事项。</div>}</div>
  </div>;
}
