import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Database,
  FileCheck2, FolderLock, RefreshCw, Server, ShieldCheck,
} from 'lucide-react';
import { agentApi, projectsApi, tasksApi } from '../api/client';
import type { AgentContextV1, Project, RunAction, RunEvent, Task } from '../types';

function humanError(error: unknown) {
  const item = error as Error & { code?: string };
  return item.code ? `${item.message}（${item.code}）` : item.message;
}

function short(value: string | null | undefined, size = 10) {
  return value ? `${value.slice(0, size)}…` : '—';
}

function actionTone(status: RunAction['status']) {
  if (status === 'succeeded') return 'border-[#2d5d50] bg-[#13231f] text-[#9ee0d1]';
  if (status === 'failed' || status === 'cancelled') return 'border-[#70423f] bg-[#241716] text-[#e9a29c]';
  if (status === 'waiting_user') return 'border-[#725329] bg-[#251d12] text-[#edc57e]';
  if (status === 'waiting_remote' || status === 'executing') return 'border-[#315b70] bg-[#12212a] text-[#92cfe7]';
  return 'border-[#3a4845] bg-[#171e20] text-[#aebbb7]';
}

function executionPreview(action: RunAction): { commands: string[]; note?: string } | null {
  const value = action.manifest.executionPreview;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as { commands?: unknown; note?: unknown };
  if (!Array.isArray(item.commands)) return null;
  const commands = item.commands.filter((command): command is string => typeof command === 'string');
  return commands.length > 0 ? { commands, note: typeof item.note === 'string' ? item.note : undefined } : null;
}

export default function AgentRunsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [context, setContext] = useState<AgentContextV1 | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [message, setMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    projectsApi.list().then(items => {
      setProjects(items);
      setProjectId(items[0]?.id ?? '');
    }).catch(error => setMessage(humanError(error)));
  }, []);

  useEffect(() => {
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(items => {
      setTasks(items);
      setTaskId(current => items.some(item => item.id === current) ? current : (items[0]?.id ?? ''));
    }).catch(error => setMessage(humanError(error)));
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!taskId) { setContext(null); setEvents([]); return; }
    setBusy(true);
    try {
      const next = await agentApi.context(taskId);
      const timeline = next.run ? await agentApi.events(next.run.id) : [];
      setContext(next);
      setEvents(timeline);
      setLastSyncedAt(new Date());
      setMessage('');
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setBusy(false);
    }
  }, [taskId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const evidenceByAction = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of context?.recentEvidenceChecks ?? []) map.set(item.action_id, (map.get(item.action_id) ?? 0) + 1);
    return map;
  }, [context]);
  const artifactsByAction = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of context?.recentArtifacts ?? []) map.set(item.action_id, (map.get(item.action_id) ?? 0) + 1);
    return map;
  }, [context]);

  return <div className="h-full overflow-y-auto bg-[#0d1214] text-[#e9f0ed]">
    <header className="border-b border-[#2a3433] bg-[#12191b] px-8 py-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.28em] text-[#67c9b5]">Codex ledger / read-only observation</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Agent 运行记录</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#92a29e]">Codex 对话是研究 Agent；这里显示已写入 Workbench 的采用上下文、动作命令预览、远程作业与证据。页面不会启动、批准、提交、取消或对账。</p>
        </div>
        <div className="text-right">
          <button onClick={refresh} disabled={busy || !taskId} className="inline-flex items-center gap-2 border border-[#40504d] bg-[#182123] px-4 py-2 text-sm hover:border-[#67c9b5] disabled:opacity-40">
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''}/>读取最新记录
          </button>
          <div className="mt-2 font-mono text-[10px] text-[#657570]">{lastSyncedAt ? `本页读取于 ${lastSyncedAt.toLocaleString()}` : '尚未读取'}</div>
        </div>
      </div>
    </header>

    <main className="space-y-5 p-8">
      <section className="grid gap-4 border border-[#293534] bg-[#131a1c] p-5 lg:grid-cols-[1fr_1fr_1.2fr]">
        <label className="text-xs text-[#91a19d]">项目<select value={projectId} onChange={event => setProjectId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white">{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs text-[#91a19d]">任务<select value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white">{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="border-l border-[#2a3433] pl-4 text-xs leading-5 text-[#91a19d]"><div className="flex items-center gap-2 font-medium text-[#dce7e3]"><Bot size={15} className="text-[#67c9b5]"/>继续处理</div><p className="mt-1">回到本项目的 Codex 对话，先运行 <code className="text-[#aee6da]">workbench context --task {taskId || '&lt;id&gt;'} --allow-blocked --pretty</code>。所有确认都在对话中完成。</p></div>
      </section>

      <section className="grid gap-px border border-[#293534] bg-[#293534] lg:grid-cols-3">
        <div className="bg-[#11181a] p-4"><div className="font-mono text-[9px] uppercase tracking-wider text-[#67c9b5]">Research Run</div><p className="mt-2 text-xs leading-5 text-[#aebbb7]">一次可追溯的研究执行会话，把任务与当时采用的方案、合同、工作流、策略快照以及全部 actions 串起来。它不是工作流节点。</p></div>
        <div className="bg-[#11181a] p-4"><div className="font-mono text-[9px] uppercase tracking-wider text-[#dfb26a]">合同（Contract）</div><p className="mt-2 text-xs leading-5 text-[#aebbb7]">从完整研究方案中抽出的机器可检查边界：允许的方法与软件栈、资源上限、人工关口和完成证据。它约束执行，不替代研究方案。</p></div>
        <div className="bg-[#11181a] p-4"><div className="font-mono text-[9px] uppercase tracking-wider text-[#92cfe7]">对账（Reconcile）</div><p className="mt-2 text-xs leading-5 text-[#aebbb7]">服务中断或提交响应不确定时，Codex 按唯一作业身份查询调度器，把 Workbench 记录与超算事实对齐；绝不通过重新提交来判断是否成功。</p></div>
      </section>

      {message && <div className="border-l-2 border-[#df9d6a] bg-[#251b16] px-4 py-3 text-sm text-[#edc5aa]">{message}</div>}

      <section className="grid gap-px border border-[#293534] bg-[#293534] sm:grid-cols-2 xl:grid-cols-6">
        {[
          ['Run', context?.run?.status ?? 'not started'],
          ['Context', context?.contextVersion ? `v${context.contextVersion.version}` : '—'],
          ['Actions', String(context?.recentActions.length ?? 0)],
          ['Jobs', String(context?.recentJobs.length ?? 0)],
          ['Evidence', String(context?.recentEvidenceChecks.length ?? 0)],
          ['Open reviews', String(context?.pendingReviews.length ?? 0)],
        ].map(([label, value]) => <div key={label} className="bg-[#11181a] p-4"><div className="font-mono text-[9px] uppercase tracking-[.16em] text-[#657570]">{label}</div><div className="mt-1.5 truncate text-sm text-[#e5eeeb]">{value}</div></div>)}
      </section>

      <div className="grid gap-5 xl:grid-cols-[.78fr_1.22fr]">
        <div className="space-y-5">
          <section className="border border-[#293534] bg-[#131a1c] p-5">
            <h2 className="flex items-center gap-2 font-medium"><ShieldCheck size={17} className="text-[#67c9b5]"/>采用上下文</h2>
            <dl className="mt-4 space-y-3 text-xs">
              {[
                ['Run ID', context?.run?.id], ['Context ID', context?.contextVersion?.id],
                ['Plan current / adopted', `${short(context?.research.currentPlanSha256)} / ${short(context?.research.adoptedPlanSha256)}`],
                ['Contract current / adopted', `${short(context?.research.currentContractSha256)} / ${short(context?.research.adoptedContractSha256)}`],
                ['Workflow', context?.workflow?.name], ['Policy sources', String(context?.policySources.length ?? 0)],
              ].map(([label, value]) => <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 border-b border-[#24302f] pb-2"><dt className="text-[#657570]">{label}</dt><dd className="break-all font-mono text-[#bdc9c5]">{value || '—'}</dd></div>)}
            </dl>
            {context?.research.drift && <div className="mt-4 flex gap-2 border border-[#70423f] bg-[#241716] p-3 text-xs text-[#e9a29c]"><AlertTriangle size={15} className="shrink-0"/>当前方案、合同或工作流与采用的 context 不一致。</div>}
          </section>

          <section className="border border-[#293534] bg-[#131a1c] p-5">
            <h2 className="flex items-center gap-2 font-medium"><FolderLock size={17} className="text-[#dfb26a]"/>阻塞与沟通</h2>
            <div className="mt-4 space-y-2">{context?.blockers.map(item => <div key={item.code} className="border border-[#5f482d] bg-[#211b13] p-3 text-xs text-[#e8d0aa]"><div className="font-mono text-[10px] text-[#dfb26a]">{item.code}</div><div className="mt-1 leading-5">{item.message}</div></div>)}{context && context.blockers.length === 0 && <div className="flex gap-2 border border-[#2d5d50] bg-[#13231f] p-3 text-xs text-[#9ee0d1]"><CheckCircle2 size={15}/>当前记录没有 blocker。</div>}{!context && <p className="text-sm text-[#657570]">请选择任务。</p>}</div>
          </section>
        </div>

        <section className="border border-[#293534] bg-[#131a1c] p-5">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-medium"><Activity size={17} className="text-[#67c9b5]"/>Codex actions</h2><span className="font-mono text-[10px] text-[#657570]">immutable manifests</span></div>
          <div className="mt-4 space-y-3">{context?.recentActions.map(action => <article key={action.id} className={`border p-4 ${actionTone(action.status)}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-wider opacity-70">{action.step_id}</div><h3 className="mt-1 text-sm font-medium">{action.action_type}</h3></div><span className="border border-current px-2 py-1 font-mono text-[10px] uppercase">{action.status}</span></div>
            <div className="mt-3 grid gap-2 font-mono text-[10px] opacity-75 sm:grid-cols-3"><span>manifest {short(action.manifest_sha256, 12)}</span><span>{artifactsByAction.get(action.id) ?? 0} artifacts</span><span>{evidenceByAction.get(action.id) ?? 0} checks</span></div>
            <details className="mt-3 border-t border-current/20 pt-2"><summary className="cursor-pointer text-xs opacity-75">查看命令预览、manifest 与授权摘要</summary><div className="mt-2 text-xs leading-5"><p>授权：{action.authorization_summary ?? '尚未记录'}</p>{executionPreview(action) && <div className="mt-2 border border-current/20 bg-black/20 p-3"><div className="font-mono text-[9px] uppercase opacity-60">authorized execution preview</div>{executionPreview(action)?.commands.map((command, index) => <pre key={index} className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">{command}</pre>)}<p className="mt-2 text-[10px] opacity-65">{executionPreview(action)?.note}</p></div>}<pre className="mt-2 max-h-56 overflow-auto bg-black/20 p-3 font-mono text-[10px] leading-4">{JSON.stringify(action.manifest, null, 2)}</pre></div></details>
          </article>)}{context?.run && context.recentActions.length === 0 && <div className="border border-dashed border-[#354341] p-10 text-center text-sm text-[#657570]">当前 run 尚无 Codex action。</div>}{!context?.run && <div className="border border-dashed border-[#354341] p-10 text-center text-sm text-[#657570]">尚未记录 research run。请在 Codex 对话中讨论并启动。</div>}</div>
        </section>
      </div>

      <section className="border border-[#293534] bg-[#131a1c] p-5">
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-medium"><Server size={17} className="text-[#dfb26a]"/>远程作业快照</h2><span className="flex items-center gap-1 font-mono text-[10px] text-[#657570]"><Clock3 size={12}/>只显示 Codex 最后一次对账，不是 SSH 实时终端</span></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead className="font-mono text-[9px] uppercase tracking-wider text-[#657570]"><tr>{['Job', 'Step', 'Host / root', 'State', 'Scheduler ID', 'Last reconciled'].map(label => <th key={label} className="border-b border-[#354341] px-3 py-2">{label}</th>)}</tr></thead><tbody>{context?.recentJobs.map(job => <tr key={job.id} className="border-b border-[#24302f] text-[#bac7c3]"><td className="px-3 py-3 font-mono">{job.job_name}</td><td className="px-3 py-3">{job.step_id ?? '—'}</td><td className="px-3 py-3 font-mono text-[10px]">{job.host}<br/><span className="text-[#657570]">{job.remote_root}</span></td><td className="px-3 py-3 text-[#dfb26a]">{job.status}</td><td className="px-3 py-3 font-mono">{job.job_id ?? 'unconfirmed'}</td><td className="px-3 py-3 font-mono text-[10px]">{job.reconciled_at ?? '从未对账'}</td></tr>)}</tbody></table>{context?.recentJobs.length === 0 && <div className="p-8 text-center text-sm text-[#657570]">没有已记录的远程作业。</div>}</div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><FileCheck2 size={17} className="text-[#67c9b5]"/>证据索引</h2><div className="mt-4 space-y-2">{context?.recentEvidenceChecks.map(item => <div key={item.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border border-[#293534] bg-[#0f1618] p-3 text-xs"><span className={`h-2.5 w-2.5 rounded-full ${item.status === 'pass' ? 'bg-[#67c9b5]' : item.status === 'warn' ? 'bg-[#dfb26a]' : 'bg-[#d87e77]'}`}/><div><div className="text-[#d7e1de]">{item.validator_name} <span className="text-[#657570]">v{item.validator_version}</span></div><div className="mt-1 font-mono text-[10px] text-[#657570]">{item.step_id} · {item.created_at}</div></div><span className="font-mono text-[10px] uppercase">{item.status}</span></div>)}{context?.recentEvidenceChecks.length === 0 && <p className="text-sm text-[#657570]">尚无 validator 证据。</p>}</div></section>
        <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><Database size={17} className="text-[#dfb26a]"/>追加式时间线</h2><div className="mt-4 max-h-80 overflow-y-auto border-l border-[#354341] pl-5">{events.map(event => <div key={event.id} className="relative mb-4"><span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-[#67c9b5]"/><div className="flex items-baseline justify-between gap-3"><span className="font-mono text-xs text-[#d8e3df]">#{event.sequence} {event.event_type}</span><time className="font-mono text-[9px] text-[#657570]">{event.occurred_at}</time></div><div className="mt-1 break-words text-xs leading-5 text-[#81908c]">{event.category} · {event.actor_type} · {JSON.stringify(event.payload)}</div></div>)}{events.length === 0 && <p className="text-sm text-[#657570]">尚无事件。</p>}</div></section>
      </div>
    </main>
  </div>;
}
