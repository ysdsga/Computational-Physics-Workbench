import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileCheck2, Filter, HardDriveDownload, RefreshCw, Search, Server, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { agentApi, projectsApi, tasksApi } from '../api/client';
import type { EvidenceLibraryItem, Project, Task } from '../types';

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function short(value: string, length = 12) {
  return `${value.slice(0, length)}…`;
}

export default function EvidencePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [items, setItems] = useState<EvidenceLibraryItem[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [location, setLocation] = useState('');
  const [checkStatus, setCheckStatus] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { projectsApi.list().then(setProjects).catch(error => setMessage((error as Error).message)); }, []);
  useEffect(() => {
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(next => {
      setTasks(next);
      setTaskId(current => next.some(task => task.id === current) ? current : '');
    }).catch(error => setMessage((error as Error).message));
  }, [projectId]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setItems(await agentApi.evidenceLibrary({
        projectId: projectId || undefined,
        taskId: taskId || undefined,
        location: location || undefined,
        checkStatus: checkStatus || undefined,
        search: search.trim() || undefined,
      }));
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, taskId, location, checkStatus, search]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);
  const summary = useMemo(() => ({
    local: items.filter(item => item.location === 'local').length,
    remote: items.filter(item => item.location === 'remote').length,
    checked: items.filter(item => item.checks.length > 0).length,
    missing: items.filter(item => item.local_available === false).length,
  }), [items]);

  return <div className="h-full overflow-y-auto bg-[#0d1214] p-8 text-[#e9f0ed]">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[#2a3433] pb-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.28em] text-[#67c9b5]">Evidence registry / project assets</p>
        <h1 className="mt-1 text-2xl font-semibold">证据库</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#94a39f]">管理支持任务判断的原始输出、远端产物、下载副本、处理结果和图。文件仍保存在项目目录或超算；这里保存可追溯索引、哈希与校验结论，不替代项目文件库。</p>
      </div>
      <button onClick={load} disabled={busy} className="inline-flex items-center gap-2 border border-[#42514f] bg-[#182123] px-4 py-2 text-sm hover:border-[#67c9b5] disabled:opacity-40"><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/>读取证据</button>
    </header>

    <section className="mt-5 border border-[#293534] bg-[#131a1c] p-4">
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#81908c]"><Filter size={13}/>证据定位</div>
      <div className="grid gap-3 lg:grid-cols-5">
        <select aria-label="项目筛选" value={projectId} onChange={event => setProjectId(event.target.value)} className="border border-[#354341] bg-[#0d1214] p-2.5 text-sm"><option value="">全部项目</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="任务筛选" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={!projectId} className="border border-[#354341] bg-[#0d1214] p-2.5 text-sm disabled:opacity-45"><option value="">全部任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="位置筛选" value={location} onChange={event => setLocation(event.target.value)} className="border border-[#354341] bg-[#0d1214] p-2.5 text-sm"><option value="">本地与远端</option><option value="local">已登记本地证据</option><option value="remote">远端证据</option></select>
        <select aria-label="校验筛选" value={checkStatus} onChange={event => setCheckStatus(event.target.value)} className="border border-[#354341] bg-[#0d1214] p-2.5 text-sm"><option value="">全部校验</option><option value="pass">通过</option><option value="warn">警告</option><option value="fail">失败</option><option value="unchecked">未校验</option></select>
        <label className="relative"><Search size={14} className="absolute left-3 top-3 text-[#657570]"/><input aria-label="搜索证据" value={search} onChange={event => setSearch(event.target.value)} placeholder="路径、类型、项目、任务" className="w-full border border-[#354341] bg-[#0d1214] py-2.5 pl-9 pr-3 text-sm placeholder:text-[#657570]"/></label>
      </div>
    </section>

    <section className="mt-5 grid gap-px border border-[#293534] bg-[#293534] sm:grid-cols-5">
      {[['结果', items.length], ['本地', summary.local], ['远端', summary.remote], ['已校验', summary.checked], ['本地缺失', summary.missing]].map(([label, value]) => <div key={label} className="bg-[#131a1c] p-4"><div className="font-mono text-[9px] uppercase text-[#657570]">{label}</div><div className="mt-1 text-xl">{value}</div></div>)}
    </section>
    {message && <div className="mt-5 border-l-2 border-[#d87e77] bg-[#241716] p-3 text-sm text-[#e9a29c]">{message}</div>}

    <section className="mt-6 space-y-3">
      {items.map(item => <article key={item.id} className="border border-[#293534] bg-[#131a1c]">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.3fr)_.7fr_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[9px] uppercase ${item.location === 'local' ? 'border-[#2d5d50] text-[#9ee0d1]' : 'border-[#315b70] text-[#92cfe7]'}`}>{item.location === 'local' ? <HardDriveDownload size={11}/> : <Server size={11}/>} {item.location}</span><span className="border border-[#3a4845] px-2 py-1 font-mono text-[9px] text-[#aebbb7]">{item.category}</span>{item.local_available === false && <span className="inline-flex items-center gap-1 text-xs text-[#e9a29c]"><TriangleAlert size={13}/>本地文件已不可用</span>}</div>
            <h2 className="mt-3 break-all font-mono text-sm text-[#e5eeeb]">{item.path}</h2>
            <div className="mt-2 text-xs text-[#91a19d]"><Link className="hover:text-[#67c9b5]" to={`/project/${item.project_id}`}>{item.project_name}</Link> / <Link className="hover:text-[#67c9b5]" to={`/task/${item.task_id}`}>{item.task_name}</Link></div>
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-[#657570]">大小</dt><dd>{humanSize(item.size_bytes)}</dd><dt className="text-[#657570]">SHA-256</dt><dd className="font-mono" title={item.sha256}>{short(item.sha256)}</dd><dt className="text-[#657570]">工作流步骤</dt><dd>{item.step_id}</dd><dt className="text-[#657570]">动作</dt><dd>{item.action_type}</dd><dt className="text-[#657570]">Run / Job</dt><dd>{item.run_status} / {item.job_status ?? '—'}</dd></dl>
          <div className="min-w-36"><div className="font-mono text-[9px] uppercase text-[#657570]">校验结论</div><div className="mt-2 flex flex-wrap gap-1">{item.checks.map(check => <span key={check.id} title={`${check.validator_name} ${check.validator_version}`} className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] uppercase ${check.status === 'pass' ? 'border-[#2d5d50] text-[#9ee0d1]' : check.status === 'warn' ? 'border-[#70532d] text-[#edc57e]' : 'border-[#70423f] text-[#e9a29c]'}`}><CheckCircle2 size={11}/>{check.status}</span>)}{item.checks.length === 0 && <span className="text-xs text-[#657570]">尚未校验</span>}</div></div>
        </div>
        <details className="border-t border-[#26302f] px-5 py-3"><summary className="cursor-pointer text-xs text-[#81908c]">查看登记信息与处理结果</summary><pre className="mt-3 max-h-72 overflow-auto bg-[#0b1113] p-3 text-[10px] leading-5 text-[#aab8b4]">{JSON.stringify({ artifactId: item.id, runId: item.run_id, actionId: item.action_id, createdAt: item.created_at, metadata: item.metadata, checks: item.checks }, null, 2)}</pre></details>
      </article>)}
      {!busy && items.length === 0 && <div className="border border-dashed border-[#354341] p-14 text-center"><FileCheck2 size={36} className="mx-auto text-[#3a4845]"/><p className="mt-3 text-sm text-[#81908c]">当前筛选下没有已登记证据。</p><p className="mt-1 text-xs text-[#657570]">Codex 可先下载远端文件、在本地处理或绘图，再把原始文件和派生产物一起登记为证据。</p></div>}
    </section>
  </div>;
}
