import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, CloudCog, FileCheck2, Play, RefreshCw, Save, ShieldCheck, TerminalSquare } from 'lucide-react';
import { agentApi, contractsApi, projectsApi, researchPlansApi, tasksApi } from '../api/client';
import type { AgentContextV1, AgentPolicyDocument, Project, ResearchPlan, RunEvent, Task } from '../types';

const defaultPolicy: AgentPolicyDocument = {
  schemaVersion: 1, remoteEnabled: false, smokeAuthorized: false,
  allowedOperations: ['context', 'event.append', 'review.request'], allowedHosts: [], allowedMethods: [],
  limits: { maxCoresPerJob: 1, maxWallMinutes: 1, maxConcurrentJobs: 1, maxAutomaticRetries: 1 },
  protectedPaths: [], humanGates: ['final_interpretation'],
};

function humanError(error: unknown) {
  const item = error as Error & { code?: string };
  return item.code ? `${item.message}（${item.code}）` : item.message;
}

export default function AgentRunsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<ResearchPlan[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [planId, setPlanId] = useState('');
  const [context, setContext] = useState<AgentContextV1 | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [contractText, setContractText] = useState('');
  const [contractPlanHash, setContractPlanHash] = useState<string>();
  const [policyScope, setPolicyScope] = useState<'system' | 'project' | 'task'>('task');
  const [policyText, setPolicyText] = useState(JSON.stringify(defaultPolicy, null, 2));
  const [host, setHost] = useState(''); const [remoteRoot, setRemoteRoot] = useState(''); const [queue, setQueue] = useState('');
  const [confirmSmoke, setConfirmSmoke] = useState(false); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => { projectsApi.list().then(items => { setProjects(items); if (items[0]) setProjectId(items[0].id); }).catch(error => setMessage(humanError(error))); }, []);
  useEffect(() => {
    if (!projectId) return;
    Promise.all([tasksApi.list(projectId), researchPlansApi.list({ projectId })]).then(([taskItems, planItems]) => {
      setTasks(taskItems); setPlans(planItems); setTaskId(taskItems[0]?.id ?? ''); setPlanId(planItems[0]?.id ?? '');
    }).catch(error => setMessage(humanError(error)));
  }, [projectId]);

  const refresh = async () => {
    if (!taskId) return; setBusy(true);
    try { const next = await agentApi.context(taskId); setContext(next); setEvents(next.run ? await agentApi.events(next.run.id) : []); setMessage('上下文已刷新'); }
    catch (error) { setMessage(humanError(error)); } finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadContract = async () => {
    if (!planId) return; setBusy(true);
    try { const result = await contractsApi.get(planId); setContractText(result.content); setContractPlanHash(result.planSha256); setMessage(result.drift ? '合同与当前方案存在 drift' : '合同已加载'); }
    catch (error) {
      const item = error as Error & { code?: string };
      if (item.code === 'CONTRACT_MISSING') {
        try { const result = await contractsApi.initialize(planId); setContractText(result.content); setMessage('已生成最小合同，请审阅后保存'); }
        catch (inner) { setMessage(humanError(inner)); }
      } else setMessage(humanError(error));
    } finally { setBusy(false); }
  };
  const saveContract = async () => { setBusy(true); try { const result = await contractsApi.update(planId, contractText, contractPlanHash); setContractText(result.content); setMessage('合同已校验并保存'); } catch (error) { setMessage(humanError(error)); } finally { setBusy(false); } };
  const start = async () => { setBusy(true); try { await agentApi.startRun(taskId, planId, `ui-start-${taskId}-${planId}`); setMessage('研究运行已启动'); await refresh(); } catch (error) { setMessage(humanError(error)); } finally { setBusy(false); } };
  const savePolicy = async () => {
    setBusy(true); try { const scopeId = policyScope === 'system' ? null : policyScope === 'project' ? projectId : taskId; await agentApi.createPolicy(policyScope, scopeId, JSON.parse(policyText), true); const successMessage = context?.run ? `${policyScope} 策略已激活并写入运行上下文版本` : `${policyScope} 策略已激活，将在启动运行时冻结`; if (context?.run) await agentApi.adoptPolicy(context.run.id, `UI adopted ${policyScope} policy`); await refresh(); setMessage(successMessage); } catch (error) { setMessage(humanError(error)); } finally { setBusy(false); }
  };
  const inspect = async () => { setBusy(true); try { const report = await agentApi.inspectRemote(taskId, host, remoteRoot); setMessage(`SSH 探测完成：${Object.values(report.commands).filter(item => item.available).length} 个命令可用`); await refresh(); } catch (error) { setMessage(humanError(error)); } finally { setBusy(false); } };
  const smoke = async () => { setBusy(true); try { await agentApi.submitSmoke(taskId, host, remoteRoot, queue, confirmSmoke, `ui-smoke-${taskId}`); setMessage('LSF smoke 已提交或恢复已有提交记录'); await refresh(); } catch (error) { setMessage(humanError(error)); } finally { setBusy(false); } };
  const policySummary = useMemo(() => context?.effectivePolicy ? `${context.effectivePolicy.allowedHosts.length} 主机 · ${context.effectivePolicy.allowedOperations.length} 操作` : '未冻结', [context]);

  return <div className="h-full overflow-y-auto bg-[#101416] text-[#e9f0ed]">
    <header className="border-b border-[#2a3433] bg-[#151b1d] px-8 py-6"><div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[11px] uppercase tracking-[.24em] text-[#62c7b2]">Agent Operations / V1</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Agent 运行中心</h1><p className="mt-2 text-sm text-[#94a39f]">冻结上下文、边界内自主行动、真实远程作业与完整证据时间线。</p></div><button onClick={refresh} disabled={busy || !taskId} className="flex items-center gap-2 border border-[#42514f] bg-[#1b2425] px-4 py-2 text-sm hover:border-[#62c7b2] disabled:opacity-40"><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/>刷新上下文</button></div></header>
    <div className="grid gap-5 p-8 xl:grid-cols-[1.2fr_.8fr]">
      <section className="border border-[#2a3433] bg-[#151b1d] p-5 xl:col-span-2"><div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-[#94a39f]">项目<select value={projectId} onChange={event => setProjectId(event.target.value)} className="mt-1 w-full border border-[#364340] bg-[#101416] p-2.5 text-sm text-white">{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs text-[#94a39f]">任务<select value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1 w-full border border-[#364340] bg-[#101416] p-2.5 text-sm text-white">{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs text-[#94a39f]">研究方案<select value={planId} onChange={event => setPlanId(event.target.value)} className="mt-1 w-full border border-[#364340] bg-[#101416] p-2.5 text-sm text-white">{plans.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      </div>{message && <div className="mt-4 border-l-2 border-[#e8b45a] bg-[#1d211d] px-4 py-2.5 font-mono text-xs text-[#e8d9bd]">{message}</div>}</section>

      <section className="border border-[#2a3433] bg-[#151b1d] p-5"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-medium"><Activity size={18} className="text-[#62c7b2]"/>运行态</h2><span className="font-mono text-xs text-[#94a39f]">{context?.run?.status ?? 'NOT STARTED'}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-px bg-[#2a3433]">{[['Context', context?.contextVersion ? `v${context.contextVersion.version}` : '—'], ['Drift', context?.research.drift ? 'DETECTED' : 'CLEAN'], ['Policy', policySummary], ['Events', String(context?.eventCursor ?? 0)]].map(([label, value]) => <div key={label} className="bg-[#111719] p-3"><div className="font-mono text-[10px] uppercase text-[#697874]">{label}</div><div className="mt-1 text-sm">{value}</div></div>)}</div>
        {!context?.run && <button onClick={start} disabled={busy || !taskId || !planId} className="mt-4 flex w-full items-center justify-center gap-2 bg-[#62c7b2] px-4 py-2.5 text-sm font-semibold text-[#0c1615] hover:bg-[#79d7c4] disabled:opacity-40"><Play size={16}/>启动研究运行</button>}
        <div className="mt-5 space-y-2">{context?.blockers.map(item => <div key={item.code} className="flex gap-2 border border-[#57442e] bg-[#211d17] p-3 text-xs text-[#e8d9bd]"><AlertTriangle size={15} className="shrink-0 text-[#e8b45a]"/><span><b className="font-mono">{item.code}</b><br/>{item.message}</span></div>)}{context && context.blockers.length === 0 && <div className="flex gap-2 border border-[#284c44] bg-[#13231f] p-3 text-xs text-[#9ee0d1]"><CheckCircle2 size={15}/>当前上下文无阻塞项</div>}</div>
      </section>

      <section className="border border-[#2a3433] bg-[#151b1d] p-5"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-medium"><FileCheck2 size={18} className="text-[#e8b45a]"/>研究合同</h2><button onClick={loadContract} disabled={!planId || busy} className="text-xs text-[#62c7b2] hover:underline">加载 / 初始化</button></div><textarea value={contractText} onChange={event => setContractText(event.target.value)} placeholder="YAML 研究合同" className="mt-4 h-56 w-full resize-y border border-[#364340] bg-[#0e1315] p-3 font-mono text-xs leading-5 text-[#d8e3df] outline-none focus:border-[#62c7b2]"/><button onClick={saveContract} disabled={!contractText || busy} className="mt-3 flex items-center gap-2 border border-[#42514f] px-3 py-2 text-xs hover:border-[#62c7b2] disabled:opacity-40"><Save size={14}/>校验并保存合同</button></section>

      <section className="border border-[#2a3433] bg-[#151b1d] p-5"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-medium"><ShieldCheck size={18} className="text-[#62c7b2]"/>授权策略</h2><select value={policyScope} onChange={event => setPolicyScope(event.target.value as typeof policyScope)} className="border border-[#364340] bg-[#101416] px-2 py-1 font-mono text-xs"><option value="system">SYSTEM</option><option value="project">PROJECT</option><option value="task">TASK</option></select></div><p className="mt-2 text-xs text-[#81908c]">先激活系统上界，再依次为项目和任务收紧。下层策略无法扩大上层权限。</p><textarea value={policyText} onChange={event => setPolicyText(event.target.value)} className="mt-4 h-64 w-full resize-y border border-[#364340] bg-[#0e1315] p-3 font-mono text-xs leading-5 text-[#d8e3df] outline-none focus:border-[#62c7b2]"/><button onClick={savePolicy} disabled={busy} className="mt-3 flex items-center gap-2 border border-[#42514f] px-3 py-2 text-xs hover:border-[#62c7b2]"><ShieldCheck size={14}/>创建版本并激活</button></section>

      <section className="border border-[#2a3433] bg-[#151b1d] p-5"><h2 className="flex items-center gap-2 font-medium"><CloudCog size={18} className="text-[#e8b45a]"/>SSH / LSF Pilot</h2><p className="mt-2 text-xs text-[#81908c]">要求服务环境开关、active task policy 和已由普通 SSH 确认的 host key。</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><input value={host} onChange={event => setHost(event.target.value)} placeholder="OpenSSH host alias" className="border border-[#364340] bg-[#0e1315] p-2.5 font-mono text-xs"/><input value={remoteRoot} onChange={event => setRemoteRoot(event.target.value)} placeholder="/approved/remote/root" className="border border-[#364340] bg-[#0e1315] p-2.5 font-mono text-xs"/><input value={queue} onChange={event => setQueue(event.target.value)} placeholder="LSF queue（可选）" className="border border-[#364340] bg-[#0e1315] p-2.5 font-mono text-xs"/><label className="flex items-center gap-2 text-xs text-[#b7c3c0]"><input type="checkbox" checked={confirmSmoke} onChange={event => setConfirmSmoke(event.target.checked)}/>我确认首次 1 核 / 1 分钟 smoke</label></div><div className="mt-4 flex gap-2"><button onClick={inspect} disabled={busy || !host || !remoteRoot} className="flex items-center gap-2 border border-[#42514f] px-3 py-2 text-xs hover:border-[#62c7b2] disabled:opacity-40"><TerminalSquare size={14}/>只读探测</button><button onClick={smoke} disabled={busy || !confirmSmoke || !context?.run} className="flex items-center gap-2 bg-[#e8b45a] px-3 py-2 text-xs font-semibold text-[#17130c] disabled:opacity-40"><Play size={14}/>提交固定 smoke</button></div><div className="mt-5 space-y-2">{context?.recentJobs.map(job => <div key={job.id} className="flex items-center justify-between border border-[#2a3433] bg-[#101416] p-3 font-mono text-xs"><span>{job.job_name}<br/><span className="text-[#697874]">{job.job_id ?? job.action_token}</span></span><span className="text-[#e8b45a]">{job.status}</span></div>)}</div></section>

      <section className="border border-[#2a3433] bg-[#151b1d] p-5 xl:col-span-2"><h2 className="font-medium">追加式事件时间线</h2><div className="mt-4 max-h-80 overflow-y-auto border-l border-[#364340] pl-5">{events.map(event => <div key={event.id} className="relative mb-4"><span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-[#62c7b2]"/><div className="flex items-baseline justify-between gap-3"><span className="font-mono text-xs text-[#d8e3df]">#{event.sequence} {event.event_type}</span><time className="font-mono text-[10px] text-[#697874]">{event.occurred_at}</time></div><div className="mt-1 text-xs text-[#81908c]">{event.category} · {event.actor_type} · {JSON.stringify(event.payload)}</div></div>)}{events.length === 0 && <p className="text-sm text-[#697874]">尚无事件。</p>}</div></section>
    </div>
  </div>;
}
