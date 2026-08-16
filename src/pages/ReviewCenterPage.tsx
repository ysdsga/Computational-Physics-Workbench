import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Archive, Bot, CheckCircle2, Clock3, Filter, RefreshCw } from 'lucide-react';
import { agentApi, projectsApi, tasksApi } from '../api/client';
import type { Project, ReviewRequest, Task } from '../types';

function humanError(error: unknown) {
  const item = error as Error & { code?: string };
  return item.code ? `${item.message}（${item.code}）` : item.message;
}

export default function ReviewCenterPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(error => setMessage(humanError(error)));
  }, []);

  useEffect(() => {
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(next => {
      setTasks(next);
      setTaskId(current => next.some(task => task.id === current) ? current : '');
    }).catch(error => setMessage(humanError(error)));
  }, [projectId]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setItems(await agentApi.reviews({
        projectId: projectId || undefined,
        taskId: taskId || undefined,
        status: status || undefined,
      }));
      setLastSyncedAt(new Date());
      setMessage('');
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setBusy(false);
    }
  }, [projectId, taskId, status]);

  useEffect(() => { void load(); }, [load]);
  const openCount = useMemo(() => items.filter(item => item.status === 'open').length, [items]);

  return <div className="h-full overflow-y-auto bg-[#0d1214] p-8 text-[#e9f0ed]">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[#2a3433] pb-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.28em] text-[#dfb26a]">Conversation queue / read-only</p>
        <h1 className="mt-1 text-2xl font-semibold">待沟通事项</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#94a39f]">集中查看 Codex 提出的科学边界、方案差异、异常和不确定状态。研究者在 Codex 对话中看证据并作决定；Web 只负责筛选和显示。</p>
      </div>
      <div className="text-right"><button onClick={load} disabled={busy} className="inline-flex items-center gap-2 border border-[#42514f] bg-[#182123] px-4 py-2 text-sm hover:border-[#dfb26a] disabled:opacity-40"><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/>读取记录</button><div className="mt-2 font-mono text-[10px] text-[#657570]">{lastSyncedAt ? lastSyncedAt.toLocaleString() : '尚未读取'}</div></div>
    </header>

    <section className="mt-5 border border-[#293534] bg-[#131a1c] p-4">
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#81908c]"><Filter size={13}/>项目 / 任务 / 状态筛选</div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-[#91a19d]">项目<select value={projectId} onChange={event => setProjectId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white"><option value="">全部项目</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs text-[#91a19d]">任务<select value={taskId} onChange={event => setTaskId(event.target.value)} disabled={!projectId} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white disabled:opacity-45"><option value="">全部任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs text-[#91a19d]">状态<select value={status} onChange={event => setStatus(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white"><option value="open">待沟通</option><option value="decided">已决定</option><option value="superseded">已替代</option><option value="">全部状态</option></select></label>
      </div>
    </section>

    <section className="mt-5 grid gap-px border border-[#293534] bg-[#293534] sm:grid-cols-3">
      <div className="bg-[#131a1c] p-4"><div className="font-mono text-[9px] uppercase text-[#657570]">当前列表待沟通</div><div className="mt-1 text-xl text-[#dfb26a]">{openCount}</div></div>
      <div className="bg-[#131a1c] p-4"><div className="font-mono text-[9px] uppercase text-[#657570]">筛选结果</div><div className="mt-1 text-xl">{items.length}</div></div>
      <div className="bg-[#131a1c] p-4"><div className="flex items-center gap-2 font-mono text-[9px] uppercase text-[#657570]"><Bot size={13}/>决定位置</div><div className="mt-1 text-sm text-[#aee6da]">本项目 Codex 对话</div></div>
    </section>
    {message && <div className="mt-5 border-l-2 border-[#d87e77] bg-[#241716] p-3 text-sm text-[#e9a29c]">{message}</div>}

    <div className="mt-6 grid gap-5 xl:grid-cols-2">{items.map(item => <article key={item.id} className={`border bg-[#131a1c] ${item.status === 'open' ? 'border-[#70532d]' : 'border-[#2d4842]'}`}>
      <div className="flex items-start gap-3 border-b border-[#2a3433] p-5">{item.status === 'open' ? <AlertOctagon size={20} className="mt-0.5 shrink-0 text-[#dfb26a]"/> : <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[#67c9b5]"/>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] uppercase tracking-wider text-[#dfb26a]">{item.gate_type}</span><span className="border border-current px-2 py-0.5 font-mono text-[9px] uppercase text-[#81908c]">{item.status}</span></div><h2 className="mt-2 font-medium leading-6">{item.question}</h2><div className="mt-2 text-xs text-[#9ca9a5]">{item.project_name ?? '未知项目'} / {item.task_name ?? '未知任务'} <span className="ml-2 font-mono text-[9px] text-[#657570]">RUN {item.run_id} · {item.run_status}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-[#657570]"><span>CTX {item.context_version_id}</span><span>{item.created_at}</span><span>{item.source}</span></div></div></div>
      <div className="space-y-4 p-5">
        <div><h3 className="font-mono text-[9px] uppercase tracking-wider text-[#657570]">Codex 建议</h3><pre className="mt-2 max-h-36 overflow-auto border border-[#26302f] bg-[#0b1113] p-3 text-xs leading-5 text-[#b7c3c0]">{JSON.stringify(item.recommendation, null, 2)}</pre></div>
        <div><h3 className="font-mono text-[9px] uppercase tracking-wider text-[#657570]">证据与提案</h3><pre className="mt-2 max-h-48 overflow-auto border border-[#26302f] bg-[#0b1113] p-3 text-xs leading-5 text-[#b7c3c0]">{JSON.stringify({ evidence: item.evidence, proposal: item.proposal }, null, 2)}</pre></div>
        {item.decision ? <div className="border border-[#2d5d50] bg-[#13231f] p-3 text-xs text-[#9ee0d1]"><div className="flex items-center gap-2 font-medium"><Archive size={14}/>已记录研究者决定：{item.decision.decision}</div><p className="mt-2 leading-5">{item.decision.comment || '无附加说明'}</p><div className="mt-2 font-mono text-[9px] opacity-70">{item.decision.source} · {item.decision.created_at} · {item.decision.conversation_ref ?? 'no conversation ref'}</div></div> : <div className="border border-[#5f482d] bg-[#211b13] p-3 text-xs leading-5 text-[#e8d0aa]"><div className="flex items-center gap-2 font-medium"><Clock3 size={14}/>等待 Codex 对话处理</div><p className="mt-1">浏览页面、刷新记录或历史上的宽泛目标都不构成授权。</p></div>}
      </div>
    </article>)}{items.length === 0 && <div className="border border-dashed border-[#364340] p-12 text-center text-sm text-[#657570] xl:col-span-2">当前筛选下没有沟通事项。</div>}</div>
  </div>;
}
