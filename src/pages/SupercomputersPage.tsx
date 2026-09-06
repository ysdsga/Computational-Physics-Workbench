import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, Save, Server, ShieldCheck, Trash2, X } from 'lucide-react';
import { agentApi, projectsApi, tasksApi } from '../api/client';
import type { AgentContext, HpcConfig, HpcProfile, HpcTaskBinding, Project, RunEvent, Task } from '../types';
import { formatLocalDateTime } from '../utils/dateTime';

const EMPTY_PROFILE: HpcProfile = { id: '', name: '', sshAlias: '', userRoot: '', projectRoot: '', scheduler: 'LSF', notes: '' };

function parseConfig(project: Project | undefined): HpcConfig {
  if (!project?.hpc_config) return { profiles: [] };
  try {
    const raw = JSON.parse(project.hpc_config) as HpcConfig;
    if (Array.isArray(raw.profiles)) return { ...raw, taskBindings: Array.isArray(raw.taskBindings) ? raw.taskBindings : [] };
    if (raw.host || raw.remotePath) {
      const alias = raw.host ?? '';
      return { ...raw, profiles: [{ id: `legacy-${project.id}`, name: '原有配置', sshAlias: alias, remoteRoot: raw.remotePath ?? '', scheduler: 'LSF', notes: '旧版单根目录配置；请改为登记用户只读根和项目根。' }], defaultProfileId: `legacy-${project.id}`, taskBindings: [] };
    }
    return { ...raw, profiles: [], taskBindings: [] };
  } catch {
    return { schemaVersion: 2, profiles: [], taskBindings: [] };
  }
}

function remoteTaskRoot(profile: HpcProfile | undefined, binding: HpcTaskBinding | undefined) {
  if (!profile?.projectRoot || !binding) return '';
  return `${profile.projectRoot.replace(/\/+$/, '')}/${binding.taskRootRel}`;
}

function commandPreview(action: AgentContext['recentActions'][number]) {
  const preview = action.spec.executionPreview;
  if (!preview || typeof preview !== 'object') return [];
  const commands = (preview as { commands?: unknown }).commands;
  return Array.isArray(commands) ? commands.filter((item): item is string => typeof item === 'string') : [];
}

function eventText(event: RunEvent, key: string) {
  const value = event.payload[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export default function SupercomputersPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [config, setConfig] = useState<HpcConfig>({ schemaVersion: 2, profiles: [], taskBindings: [] });
  const [context, setContext] = useState<AgentContext | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [draft, setDraft] = useState<HpcProfile | null>(null);
  const [bindingProfileId, setBindingProfileId] = useState('');
  const [taskRootDraft, setTaskRootDraft] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProjects = useCallback(async (preferId?: string) => {
    const next = await projectsApi.list();
    setProjects(next);
    setProjectId(current => preferId ?? (next.some(item => item.id === current) ? current : (next[0]?.id ?? '')));
  }, []);

  useEffect(() => { loadProjects().catch(error => setMessage((error as Error).message)); }, [loadProjects]);
  const project = projects.find(item => item.id === projectId);

  useEffect(() => {
    setConfig(parseConfig(project));
    setDraft(null);
    setContext(null);
    setEvents([]);
    if (!projectId) { setTasks([]); setTaskId(''); return; }
    tasksApi.list(projectId).then(next => {
      setTasks(next);
      setTaskId(current => next.some(item => item.id === current) ? current : (next[0]?.id ?? ''));
    }).catch(error => setMessage((error as Error).message));
  }, [project, projectId]);

  useEffect(() => {
    if (!taskId) { setContext(null); setEvents([]); return; }
    agentApi.context(taskId).then(async next => {
      setContext(next);
      setEvents(next.run ? await agentApi.events(next.run.id) : []);
    }).catch(error => setMessage((error as Error).message));
  }, [taskId]);

  useEffect(() => {
    const profileId = config.defaultProfileId ?? config.profiles?.[0]?.id ?? '';
    const existing = config.taskBindings?.find(item => item.taskId === taskId && item.profileId === profileId);
    setBindingProfileId(profileId);
    setTaskRootDraft(existing?.taskRootRel ?? '');
  }, [config, taskId]);

  const saveConfig = async (profiles: HpcProfile[], taskBindings = config.taskBindings ?? [], defaultProfileId = config.defaultProfileId) => {
    if (!project) return;
    setSaving(true);
    try {
      const nextConfig: HpcConfig = {
        schemaVersion: 2,
        profiles,
        taskBindings,
        defaultProfileId: profiles.some(item => item.id === defaultProfileId) ? defaultProfileId : profiles[0]?.id,
      };
      await projectsApi.update(project.id, { hpc_config: JSON.stringify(nextConfig) });
      setConfig(nextConfig);
      await loadProjects(project.id);
      setDraft(null);
      setMessage('连接元数据已保存；这不会授予 Codex 远程执行权限。');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = () => {
    if (!draft?.name.trim() || !draft.sshAlias.trim() || !draft.userRoot?.trim() || !draft.projectRoot?.trim()) {
      setMessage('名称、OpenSSH 别名、用户只读根和项目根目录为必填项。');
      return;
    }
    const normalized: HpcProfile = { ...draft, name: draft.name.trim(), sshAlias: draft.sshAlias.trim(), userRoot: draft.userRoot.trim(), projectRoot: draft.projectRoot.trim(), scheduler: draft.scheduler.trim() || 'LSF', notes: draft.notes.trim(), id: draft.id || `hpc-${Date.now()}` };
    delete normalized.remoteRoot;
    const profiles = [...(config.profiles ?? [])];
    const index = profiles.findIndex(item => item.id === normalized.id);
    if (index >= 0) profiles[index] = normalized; else profiles.push(normalized);
    void saveConfig(profiles, config.taskBindings ?? [], config.defaultProfileId ?? normalized.id);
  };

  const saveTaskBinding = () => {
    if (!taskId || !bindingProfileId || !taskRootDraft.trim()) {
      setMessage('请选择任务和连接，并填写远程任务目录名。');
      return;
    }
    const binding: HpcTaskBinding = { taskId, profileId: bindingProfileId, taskRootRel: taskRootDraft.trim() };
    const bindings = (config.taskBindings ?? []).filter(item => !(item.taskId === taskId && item.profileId === bindingProfileId));
    void saveConfig(config.profiles ?? [], [...bindings, binding]);
  };

  const legacyTransfers = useMemo(() => context?.recentActions.filter(action => action.action_type === 'files.upload' || action.action_type === 'files.download') ?? [], [context]);
  const transferEvents = useMemo(() => events.filter(event => event.event_type === 'remote.file_uploaded' || event.event_type === 'remote.file_downloaded').reverse(), [events]);
  const sessionEvents = useMemo(() => events.filter(event => event.event_type.startsWith('remote.command_') || event.event_type === 'remote.task_root_ready').reverse().slice(0, 20), [events]);
  const envelope = context?.run?.confirmed_envelope;
  const bindingProfile = config.profiles?.find(item => item.id === bindingProfileId);
  const selectedBinding = config.taskBindings?.find(item => item.taskId === taskId && item.profileId === bindingProfileId);
  const configuredTaskRoot = remoteTaskRoot(bindingProfile, selectedBinding);

  return <div className="h-full overflow-y-auto bg-[#0d1214] p-8 text-[#e9f0ed]">
    <header className="border-b border-[#2a3433] pb-5">
      <p className="font-mono text-[10px] uppercase tracking-[.28em] text-[#92cfe7]">Remote infrastructure / governed</p>
      <h1 className="mt-1 text-2xl font-semibold">超算管理</h1>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-[#94a39f]">统一维护 OpenSSH 连接、用户只读根、项目目录和任务写目录，并观察 Task 会话命令、传输与作业。这里不保存密码或私钥，也不直接执行；实际动作由 Codex 在已确认 Task Spec 边界内完成并自动写入日志。</p>
    </header>

    <section className="mt-5 grid gap-3 border border-[#293534] bg-[#131a1c] p-4 md:grid-cols-2">
      <label className="text-xs text-[#91a19d]">项目<select value={projectId} onChange={event => setProjectId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white">{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-xs text-[#91a19d]">用于查看有效边界与运行记录的任务<select value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1.5 w-full border border-[#354341] bg-[#0d1214] p-2.5 text-sm text-white"><option value="">不选择任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </section>
    {message && <div className="mt-4 border-l-2 border-[#92cfe7] bg-[#12212a] px-4 py-3 text-sm text-[#b8deed]">{message}</div>}

    <div className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <section className="border border-[#293534] bg-[#131a1c] p-5">
        <div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 font-medium"><Server size={17} className="text-[#92cfe7]"/>连接配置</h2><p className="mt-1 text-xs text-[#657570]">配置属于当前项目；OpenSSH alias 应在本机 SSH 配置中解析。</p></div><button onClick={() => setDraft({ ...EMPTY_PROFILE })} className="inline-flex items-center gap-1.5 border border-[#315b70] px-3 py-2 text-xs text-[#92cfe7] hover:bg-[#12212a]"><Plus size={13}/>新增</button></div>
        <div className="mt-4 space-y-3">{(config.profiles ?? []).map(profile => <article key={profile.id} className={`border p-4 ${profile.id === config.defaultProfileId ? 'border-[#315b70] bg-[#12212a]' : 'border-[#293534] bg-[#0f1618]'}`}>
          <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{profile.name}</h3>{profile.id === config.defaultProfileId && <span className="border border-[#315b70] px-2 py-0.5 font-mono text-[9px] uppercase text-[#92cfe7]">default</span>}</div><div className="mt-2 font-mono text-xs text-[#b9c7c3]">{profile.sshAlias} · {profile.scheduler}</div>{profile.userRoot && profile.projectRoot ? <div className="mt-2 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 font-mono text-[10px] text-[#657570]"><span>User · RO</span><span className="break-all">{profile.userRoot}</span><span>Project</span><span className="break-all">{profile.projectRoot}</span></div> : <div className="mt-2 text-xs text-[#dfb26a]">旧版单根目录：{profile.remoteRoot ?? '—'}；请编辑并补齐三级边界。</div>}</div><div className="flex gap-1"><button title="编辑配置" onClick={() => setDraft({ ...EMPTY_PROFILE, ...profile, userRoot: profile.userRoot ?? '', projectRoot: profile.projectRoot ?? '' })} className="p-2 text-[#81908c] hover:text-white"><Pencil size={13}/></button><button title="删除配置" onClick={() => { if (confirm(`只删除连接元数据“${profile.name}”？远端文件不会被删除。`)) void saveConfig((config.profiles ?? []).filter(item => item.id !== profile.id), (config.taskBindings ?? []).filter(item => item.profileId !== profile.id)); }} className="p-2 text-[#81908c] hover:text-[#e9a29c]"><Trash2 size={13}/></button></div></div>
          {profile.notes && <p className="mt-3 border-t border-[#26302f] pt-3 text-xs leading-5 text-[#81908c]">{profile.notes}</p>}
          {profile.id !== config.defaultProfileId && <button onClick={() => void saveConfig(config.profiles ?? [], config.taskBindings ?? [], profile.id)} className="mt-3 text-[10px] text-[#92cfe7] hover:underline">设为项目默认连接</button>}
        </article>)}{(config.profiles ?? []).length === 0 && <div className="border border-dashed border-[#354341] p-10 text-center text-sm text-[#657570]">当前项目尚未登记超算连接。</div>}</div>
      </section>

      <section className="border border-[#293534] bg-[#131a1c] p-5">
        <h2 className="flex items-center gap-2 font-medium"><ShieldCheck size={17} className="text-[#67c9b5]"/>当前任务的远程边界</h2>
        {!taskId && <p className="mt-4 text-sm text-[#657570]">选择任务后登记远程任务目录，并显示连接配置与该 Run 已确认的执行边界。</p>}
        {taskId && <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 border border-[#293534] bg-[#0f1618] p-3 text-xs"><dt className="text-[#657570]">本地项目根</dt><dd className="break-all font-mono">{project?.working_dir || '—'}</dd><dt className="text-[#657570]">本地任务根</dt><dd className="break-all font-mono">{context?.taskRoot.absolute ?? context?.taskRoot.relative ?? '—'}</dd></dl>
          {(config.profiles ?? []).length > 0 ? <div className="border border-[#315b70] bg-[#12212a] p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="text-xs text-[#91a19d]">连接<select value={bindingProfileId} onChange={event => { const nextId = event.target.value; setBindingProfileId(nextId); setTaskRootDraft(config.taskBindings?.find(item => item.taskId === taskId && item.profileId === nextId)?.taskRootRel ?? ''); }} className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 text-sm text-white">{config.profiles?.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
              <label className="text-xs text-[#91a19d]">任务目录名<input value={taskRootDraft} onChange={event => setTaskRootDraft(event.target.value)} placeholder="例如：tk001_cacro3_nm_dmft" className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 font-mono text-sm text-white"/></label>
              <button onClick={saveTaskBinding} disabled={saving || !bindingProfile?.userRoot || !bindingProfile.projectRoot} className="self-end bg-[#2a718b] px-4 py-2.5 text-xs text-white disabled:opacity-40"><Save size={13} className="mr-1 inline"/>保存映射</button>
            </div>
            <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 border-t border-[#315b70] pt-3 text-xs"><dt className="text-[#657570]">用户根 · 只读</dt><dd className="break-all font-mono">{bindingProfile?.userRoot ?? '—'}</dd><dt className="text-[#657570]">项目根</dt><dd className="break-all font-mono">{bindingProfile?.projectRoot ?? '—'}</dd><dt className="text-[#657570]">任务根 · 读写</dt><dd className="break-all font-mono text-[#9ee0d1]">{configuredTaskRoot || '尚未保存任务目录映射'}</dd></dl>
          </div> : <div className="border border-dashed border-[#354341] p-5 text-center text-sm text-[#657570]">请先在左侧登记超算连接、用户只读根和项目根。</div>}
        </div>}
        {taskId && !envelope && <p className="mt-4 text-sm text-[#dfb26a]">该任务尚无已确认 Task Spec；目录映射只描述可去哪里，不会单独启动执行。</p>}
        {envelope && <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-xs"><dt className="text-[#657570]">采用连接</dt><dd className="font-mono">{envelope.hpcProfileId ?? 'local only'}</dd><dt className="text-[#657570]">允许能力</dt><dd>{envelope.allowedCapabilities.join(', ')}</dd><dt className="text-[#657570]">保护路径</dt><dd className="font-mono">{envelope.protectedRelativePaths.join(', ') || 'none'}</dd><dt className="text-[#657570]">资源上限</dt><dd>{envelope.resourceLimits.maxCoresPerJob} 核/作业 · {envelope.resourceLimits.maxWallMinutes} 分钟 · {envelope.resourceLimits.maxConcurrentJobs} 并发 · {envelope.resourceLimits.maxAutomaticRetries} 自动重试</dd></dl>
          <div className="border border-[#2d4842] bg-[#13201d] p-3 text-xs leading-5 text-[#a9d5ca]">连接配置固定远程主机与 Task 写根；Task Spec 固定科学和资源边界；Codex 在一次确认后的 Task 会话内自主执行。普通命令写 Event，只有科学里程碑和作业使用 Action。</div>
        </div>}
      </section>
    </div>

    {draft && <section className="mt-5 border border-[#315b70] bg-[#12212a] p-5"><div className="flex items-center justify-between"><h2 className="font-medium">{draft.id ? '编辑连接' : '新增连接'}</h2><button onClick={() => setDraft(null)} className="p-1 text-[#81908c] hover:text-white"><X size={16}/></button></div><div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-xs text-[#91a19d]">显示名称<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：校级 LSF 集群" className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 text-sm text-white"/></label>
      <label className="text-xs text-[#91a19d]">OpenSSH 别名<input value={draft.sshAlias} onChange={event => setDraft({ ...draft, sshAlias: event.target.value })} placeholder="例如：my-lsf" className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 font-mono text-sm text-white"/></label>
      <label className="text-xs text-[#91a19d]">用户只读根<input value={draft.userRoot ?? ''} onChange={event => setDraft({ ...draft, userRoot: event.target.value })} placeholder="/public/home/username" className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 font-mono text-sm text-white"/></label>
      <label className="text-xs text-[#91a19d]">远程项目根<input value={draft.projectRoot ?? ''} onChange={event => setDraft({ ...draft, projectRoot: event.target.value })} placeholder="/public/home/username/pj001_project" className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 font-mono text-sm text-white"/></label>
      <label className="text-xs text-[#91a19d]">调度器（当前版本仅支持 IBM LSF）<select value="LSF" disabled className="mt-1.5 w-full border border-[#365363] bg-[#0d1214] p-2.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-70"><option value="LSF">IBM LSF</option></select></label>
      <label className="text-xs text-[#91a19d] md:col-span-2">说明与登录边界<textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} rows={3} placeholder="登录节点用途、传输约定、队列说明；不要填写密码或私钥。" className="mt-1.5 w-full resize-none border border-[#365363] bg-[#0d1214] p-2.5 text-sm text-white"/></label>
    </div><button onClick={submitDraft} disabled={saving} className="mt-4 inline-flex items-center gap-2 bg-[#2a718b] px-4 py-2 text-sm text-white disabled:opacity-40"><Save size={14}/>{saving ? '保存中…' : '保存连接元数据'}</button></section>}

    <section className="mt-5 border border-[#293534] bg-[#131a1c] p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 font-medium"><Activity size={17} className="text-[#92cfe7]"/>Task 会话记录</h2><p className="mt-1 text-xs text-[#657570]">显示 Codex 已在超算执行的持久化命令记录；不是实时终端，也不提供输入框。</p></div><span className="font-mono text-[9px] uppercase tracking-wider text-[#657570]">event log · latest 20 · local time</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="font-mono text-[9px] uppercase text-[#657570]"><tr>{['时间', '状态', 'Scope / Access', 'Host / CWD', 'Command'].map(label => <th key={label} className="border-b border-[#354341] px-3 py-2">{label}</th>)}</tr></thead><tbody>{sessionEvents.map(event => <tr key={event.id} className="border-b border-[#24302f] align-top"><td className="whitespace-nowrap px-3 py-3 font-mono text-[9px] text-[#657570]">{formatLocalDateTime(event.occurred_at)}</td><td className={`px-3 py-3 font-mono text-[10px] ${event.event_type.includes('failed') ? 'text-[#e9a29c]' : 'text-[#9ee0d1]'}`}>{event.event_type === 'remote.task_root_ready' ? 'ROOT READY' : event.event_type.replace('remote.command_', '').toUpperCase()}</td><td className="px-3 py-3 font-mono text-[10px] text-[#92cfe7]">{eventText(event, 'scope') || 'task'} / {eventText(event, 'access') || '—'}</td><td className="max-w-64 break-all px-3 py-3 font-mono text-[10px] text-[#81908c]">{eventText(event, 'host')}<br/>{eventText(event, 'cwd') || eventText(event, 'taskRoot')}</td><td className="max-w-xl px-3 py-3"><pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[#c4d0cc]">{eventText(event, 'command') || '—'}</pre></td></tr>)}</tbody></table>{sessionEvents.length === 0 && <div className="border border-dashed border-[#354341] p-8 text-center text-sm text-[#657570]">当前 Run 尚无远程会话命令。</div>}</div></section>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><Activity size={17} className="text-[#92cfe7]"/>上传与下载记录</h2><p className="mt-1 text-xs text-[#657570]">新会话传输直接记 Event；旧 Run 的 Action 记录继续兼容显示。</p><div className="mt-4 space-y-2">{transferEvents.map(event => { const upload = event.event_type === 'remote.file_uploaded'; return <article key={event.id} className="border border-[#293534] bg-[#0f1618] p-3 text-xs"><div className="flex justify-between gap-3"><span className="flex items-center gap-2 text-[#d7e1de]">{upload ? <ArrowUpFromLine size={14} className="text-[#92cfe7]"/> : <ArrowDownToLine size={14} className="text-[#67c9b5]"/>}{upload ? '上传' : '下载'}</span><span className="font-mono text-[9px] text-[#657570]">{formatLocalDateTime(event.occurred_at)}</span></div><div className="mt-2 break-all font-mono text-[10px] text-[#9ca9a5]">{eventText(event, 'localPath')} ↔ {eventText(event, 'remotePath')}</div></article>; })}{legacyTransfers.map(action => <article key={action.id} className="border border-[#293534] bg-[#0f1618] p-3 text-xs"><div className="flex justify-between gap-3"><span className="flex items-center gap-2 text-[#d7e1de]">{action.action_type === 'files.upload' ? <ArrowUpFromLine size={14} className="text-[#92cfe7]"/> : <ArrowDownToLine size={14} className="text-[#67c9b5]"/>}{action.action_type} · legacy Action</span><span className="font-mono uppercase text-[#dfb26a]">{action.status}</span></div>{commandPreview(action).map((command, index) => <pre key={index} className="mt-2 overflow-x-auto bg-black/20 p-2 font-mono text-[10px] text-[#9ca9a5]">{command}</pre>)}</article>)}{transferEvents.length === 0 && legacyTransfers.length === 0 && <div className="border border-dashed border-[#354341] p-8 text-center text-sm text-[#657570]">当前 Run 没有传输记录。</div>}</div></section>
      <section className="border border-[#293534] bg-[#131a1c] p-5"><h2 className="flex items-center gap-2 font-medium"><Server size={17} className="text-[#dfb26a]"/>远程作业记录</h2><p className="mt-1 text-xs text-[#657570]">Codex 根据每个 Job 的规模与阶段选择检查节拍；最后一个 Job 终止后删除本 Run 自动化。Web 只显示账本。</p>{context?.monitor && <div className="mt-3 border border-[#315b70] bg-[#12212a] p-3 font-mono text-[10px] text-[#92cfe7]">monitor {context.monitor.status} · 最早可对账 {formatLocalDateTime(context.monitor.next_check_at, '已结束')} · 建议 {context.monitor.recommended_cadence_minutes ?? '—'} min · heartbeat {context.monitor.heartbeat_fresh === false ? 'stale' : 'ok'} · automation {context.monitor.automation_ref ?? '已清理'}</div>}<div className="mt-4 space-y-2">{context?.recentJobs.map(job => <article key={job.id} className="border border-[#293534] bg-[#0f1618] p-3 text-xs"><div className="flex justify-between gap-3"><span className="font-mono text-[#d7e1de]">{job.job_name}</span><span className="font-mono uppercase text-[#dfb26a]">{job.status}</span></div><div className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1 text-[#81908c]"><span>Host</span><span className="font-mono">{job.host}</span><span>Scheduler ID</span><span className="font-mono">{job.job_id ?? 'unconfirmed'}</span><span>Queue reason</span><span>{job.queue_reason || '—'}</span><span>最近进展</span><span className="font-mono">{formatLocalDateTime(job.last_progress_at)}</span><span>最早可对账</span><span className="font-mono">{formatLocalDateTime(job.next_check_at, '已结束')}</span></div></article>)}{(!context || context.recentJobs.length === 0) && <div className="border border-dashed border-[#354341] p-8 text-center text-sm text-[#657570]">所选任务没有远程作业记录。</div>}</div></section>
    </div>
  </div>;
}
