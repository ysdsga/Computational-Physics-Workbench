import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Database, FileCheck2, FolderLock, RefreshCw, Server } from 'lucide-react';
import { agentApi, projectsApi, tasksApi } from '../api/client';
import type { AgentContext, Project, RunAction, RunEvent, Task } from '../types';

function humanError(error: unknown) {
  const item = error as Error & { code?: string };
  return item.code ? `${item.message}（${item.code}）` : item.message;
}

function short(value: string | null | undefined, size = 12) {
  return value ? `${value.slice(0, size)}…` : '—';
}

function actionTone(status: RunAction['status']) {
  if (status === 'succeeded') return 'border-[#2d5d50] bg-[#13231f] text-[#9ee0d1]';
  if (status === 'failed' || status === 'cancelled') return 'border-[#70423f] bg-[#241716] text-[#e9a29c]';
  if (status === 'waiting_researcher') return 'border-[#725329] bg-[#251d12] text-[#edc57e]';
  if (status === 'waiting_remote' || status === 'executing') return 'border-[#315b70] bg-[#12212a] text-[#92cfe7]';
  return 'border-[#3a4845] bg-[#171e20] text-[#aebbb7]';
}

function commandPreview(action: RunAction): string[] {
  const preview = action.spec.executionPreview;
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return [];
  const commands = (preview as { commands?: unknown }).commands;
  return Array.isArray(commands) ? commands.filter((item): item is string => typeof item === 'string') : [];
}

export default function AgentRunsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [context, setContext] = useState<AgentContext | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    projectsApi.list().then(items => { setProjects(items); setProjectId(items[0]?.id ?? ''); }).catch(error => setMessage(humanError(error)));
  }, []);
  useEffect(() => {
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(items => { setTasks(items); setTaskId(current => items.some(item => item.id === current) ? current : (items[0]?.id ?? '')); }).catch(error => setMessage(humanError(error)));
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!taskId) { setContext(null); setEvents([]); return; }
    setBusy(true);
    try {
      const next = await agentApi.context(taskId);
      setContext(next);
      setEvents(next.run ? await agentApi.events(next.run.id) : []);
      setMessage('');
    } catch (error) { setMessage(humanError(error)); }
    finally { setBusy(false); }
  }, [taskId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const counts = useMemo(() => ({
    actions: context?.recentActions.length ?? 0,
    jobs: context?.recentJobs.length ?? 0,
    evidence: context?.recentEvidenceChecks.length ?? 0,
    pending: context?.pendingItems.filter(item => item.status === 'open').length ?? 0,
  }), [context]);

  return <div className="h-full overflow-y-auto bg-[#0d1214] text-[#e9f0ed]">
    <header className="border-b border-[#2a3433] bg-[#12191b] px-8 py-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="font-mono text-[10px] uppercase tracking-[.28em] text-[#67c9b5]">Codex ledger / observation</p><h1 className="mt-1 text-2xl font-semibold">Agent 运行记录</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#92a29e]">Codex 对话负责规划和执行；本页只显示 Task Spec、动作、作业、证据和恢复状态，不提供启动、授权、提交、取消或对账按钮。</p></div>
        <button onClick={refresh} disabled={busy || !taskId} className="inline-flex items-center gap-2 border border-[#40504d] bg-[#182123] px-4 py-2 text-sm disabled:opacity-40"><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/>读取最新记录</button>
      </div>
    </header>
    <main className="space-y-5 p-8">
      <section className="grid gap-4 border border-[#293534] bg-[#131a1c] p-5 lg:grid-cols-[1fr_1fr_1.2fr]">
        <label className="text-xs text-[#91a19d]">项目<select value={projectId} onChange={event => setProjectId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white">{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs text-[#91a19d]">任务<select value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white">{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="border-l border-[#2a3433] pl-4 text-xs leading-5 text-[#91a19d]"><div className="flex items-center gap-2 font-medium text-[#dce7e3]"><Bot size={15} className="text-[#67c9b5]"/>继续处理</div><p className="mt-1">回到 Codex 对话运行 <code className="text-[#aee6da]">workbench context --task {taskId || '&lt;id&gt;'} --allow-blocked --pretty</code>。Researcher 决定只在对话中确认。</p></div>
      </section>
      {message && <div className="border-l-2 border-[#df9d6a] bg-[#251b16] px-4 py-3 text-sm text-[#edc5aa]">{message}</div>}
      <section className="grid gap-px border border-[#293534] bg-[#293534] sm:grid-cols-6">{[
        ['Run', context?.run?.status ?? '未开始'], ['Stage', context?.run?.current_stage_id ?? '—'], ['Actions', String(counts.actions)], ['Jobs', String(counts.jobs)], ['Monitor', context?.monitor?.status ?? '—'], ['待沟通', String(counts.pending)],
      ].map(([label, value]) => <div key={label} className="bg-[#11181a] p-4"><div className="font-mono text-[9px] uppercase text-[#657570]">{label}</div><div className="mt-1.5 truncate text-sm">{value}</div></div>)}</section>

      <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <div className="space-y-5">
          <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><FolderLock size={17} className="text-[#dfb26a]"/>Task Spec</h2>{context?.run ? <dl className="mt-4 space-y-3 text-xs">{[
            ['Objective', context.run.objective], ['Envelope revision', String(context.run.envelope_revision)], ['Profile', context.run.confirmed_envelope.hpcProfileId ?? 'local only'], ['Capabilities', context.run.confirmed_envelope.allowedCapabilities.join(', ')], ['Working plan', context.run.working_plan.summary ?? '—'],
          ].map(([label, value]) => <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 border-b border-[#24302f] pb-2"><dt className="text-[#657570]">{label}</dt><dd className="break-words text-[#bdc9c5]">{value}</dd></div>)}</dl> : <p className="mt-4 text-sm text-[#657570]">尚未生成并确认 Task Spec。</p>}</section>
          <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><AlertTriangle size={17} className="text-[#dfb26a]"/>阻塞与沟通</h2><div className="mt-4 space-y-2">{context?.blockers.map(item => <div key={item.code} className="border border-[#5f482d] bg-[#211b13] p-3 text-xs text-[#e8d0aa]"><div className="font-mono text-[10px]">{item.code}</div><div className="mt-1">{item.message}</div></div>)}{context && context.blockers.length === 0 && <div className="flex gap-2 border border-[#2d5d50] bg-[#13231f] p-3 text-xs text-[#9ee0d1]"><CheckCircle2 size={15}/>当前没有全局 blocker；各阶段仍以待沟通事项为准。</div>}</div></section>
        </div>
        <section className="border border-[#293534] bg-[#131a1c] p-5"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-medium"><Activity size={17} className="text-[#67c9b5]"/>Codex Actions</h2><span className="font-mono text-[10px] text-[#657570]">stage → action → jobs/artifacts</span></div><div className="mt-4 space-y-3">{context?.recentActions.map(action => <article key={action.id} className={`border p-4 ${actionTone(action.status)}`}><div className="flex justify-between gap-3"><div><div className="font-mono text-[10px] opacity-70">{action.stage_id}{action.step_id ? ` / ${action.step_id}` : ''}</div><h3 className="mt-1 text-sm font-medium">{action.action_type}</h3></div><span className="h-fit border border-current px-2 py-1 font-mono text-[10px] uppercase">{action.status}</span></div><div className="mt-3 font-mono text-[10px] opacity-75">spec {short(action.spec_sha256)}</div><details className="mt-3 border-t border-current/20 pt-2"><summary className="cursor-pointer text-xs opacity-75">查看动作规格与命令预览</summary>{commandPreview(action).map((command, index) => <pre key={index} className="mt-2 overflow-x-auto whitespace-pre-wrap bg-black/20 p-2 font-mono text-[10px]">{command}</pre>)}<pre className="mt-2 max-h-56 overflow-auto bg-black/20 p-3 font-mono text-[10px]">{JSON.stringify(action.spec, null, 2)}</pre></details></article>)}{context?.run && !context.recentActions.length && <div className="border border-dashed border-[#354341] p-10 text-center text-sm text-[#657570]">当前 Run 尚无 Action。</div>}{!context?.run && <div className="border border-dashed border-[#354341] p-10 text-center text-sm text-[#657570]">请先在 Codex 对话中讨论研究方案和 Task Spec。</div>}</div></section>
      </div>

      <section className="border border-[#293534] bg-[#131a1c] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-medium"><Server size={17} className="text-[#dfb26a]"/>远程作业</h2>{context?.monitor && <p className="mt-1 font-mono text-[10px] text-[#657570]">monitor {context.monitor.status} · next {context.monitor.next_check_at ?? 'terminal'} · {context.monitor.active_job_count ?? 0} active</p>}</div><span className="flex items-center gap-1 font-mono text-[10px] text-[#657570]"><Clock3 size={12}/>显示持久化观察，不是实时终端</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="font-mono text-[9px] uppercase text-[#657570]"><tr>{['Job', 'Stage / Action', 'Host / Workdir', 'State', 'Queue reason', 'Last progress', 'Next check'].map(label => <th key={label} className="border-b border-[#354341] px-3 py-2">{label}</th>)}</tr></thead><tbody>{context?.recentJobs.map(job => <tr key={job.id} className="border-b border-[#24302f] text-[#bac7c3]"><td className="px-3 py-3 font-mono">{job.job_name}<br/><span className="text-[9px] text-[#657570]">{job.job_id ?? 'unconfirmed'}</span></td><td className="px-3 py-3">{job.stage_id}<br/><span className="font-mono text-[9px] text-[#657570]">{short(job.action_id)}</span></td><td className="px-3 py-3 font-mono text-[10px]">{job.host}<br/>{job.remote_workdir}</td><td className="px-3 py-3 text-[#dfb26a]">{job.status}</td><td className="max-w-64 px-3 py-3 text-[10px] text-[#81908c]">{job.queue_reason || '—'}</td><td className="px-3 py-3 font-mono text-[10px]">{job.last_progress_at ?? '—'}</td><td className="px-3 py-3 font-mono text-[10px]">{job.next_check_at ?? 'terminal'}</td></tr>)}</tbody></table>{!context?.recentJobs.length && <div className="p-8 text-center text-sm text-[#657570]">没有已记录的远程作业。</div>}</div></section>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><FileCheck2 size={17} className="text-[#67c9b5]"/>证据检查（{counts.evidence}）</h2><div className="mt-4 space-y-2">{context?.recentEvidenceChecks.map(item => <div key={item.id} className="grid grid-cols-[auto_1fr_auto] gap-3 border border-[#293534] p-3 text-xs"><span className={`mt-1 h-2.5 w-2.5 rounded-full ${item.status === 'pass' ? 'bg-[#67c9b5]' : item.status === 'warn' ? 'bg-[#dfb26a]' : 'bg-[#d87e77]'}`}/><div>{item.validator_name}<div className="mt-1 font-mono text-[10px] text-[#657570]">{item.stage_id} · {item.created_at}</div></div><span className="font-mono text-[10px] uppercase">{item.status}</span></div>)}</div></section>
        <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><Database size={17} className="text-[#dfb26a]"/>时间线</h2><div className="mt-4 max-h-80 overflow-y-auto border-l border-[#354341] pl-5">{events.map(event => <div key={event.id} className="relative mb-4"><span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-[#67c9b5]"/><div className="flex justify-between gap-3"><span className="font-mono text-xs">#{event.sequence} {event.event_type}</span><time className="font-mono text-[9px] text-[#657570]">{event.occurred_at}</time></div><div className="mt-1 text-xs text-[#81908c]">{event.category} · {event.actor_type} · {JSON.stringify(event.payload)}</div></div>)}</div></section>
      </div>
    </main>
  </div>;
}
