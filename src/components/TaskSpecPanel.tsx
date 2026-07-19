import { useState } from 'react';
import { BookOpen, CheckCircle2, ClipboardCheck, Copy, Edit3, ShieldAlert, XCircle } from 'lucide-react';
import { experiencesApi, taskSpecsApi } from '../api/client';
import type { TaskSpec, TaskSpecStatus } from '../types';

interface Props {
  specs: TaskSpec[];
  onChanged: (spec: TaskSpec) => void;
}

const statusLabels: Record<TaskSpecStatus, string> = {
  draft: '草稿',
  awaiting_approval: '等待审批',
  ready: '可执行',
  executing: '执行中',
  monitoring: '作业监控中',
  verifying: '等待验证',
  completed: '已验证',
  failed: '失败',
  unknown: '状态未知',
  blocked: '已阻止',
};

const statusClasses: Record<TaskSpecStatus, string> = {
  draft: 'text-[#9898b0] bg-[#2d2d44]',
  awaiting_approval: 'text-[#fbbf24] bg-[#f59e0b]/10',
  ready: 'text-[#60a5fa] bg-[#3b82f6]/10',
  executing: 'text-[#a78bfa] bg-[#8b5cf6]/10',
  monitoring: 'text-[#38bdf8] bg-[#0ea5e9]/10',
  verifying: 'text-[#22d3ee] bg-[#06b6d4]/10',
  completed: 'text-[#4ade80] bg-[#22c55e]/10',
  failed: 'text-[#f87171] bg-[#ef4444]/10',
  unknown: 'text-[#fb923c] bg-[#f97316]/10',
  blocked: 'text-[#f87171] bg-[#ef4444]/10',
};

export default function TaskSpecPanel({ specs, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editExecutionPayload, setEditExecutionPayload] = useState('');
  const [editWorkdir, setEditWorkdir] = useState('');
  const [editTimeout, setEditTimeout] = useState(30);
  const [editCriteria, setEditCriteria] = useState('');
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [experienceSpecId, setExperienceSpecId] = useState<string | null>(null);
  const [experienceTitle, setExperienceTitle] = useState('');
  const [experienceContent, setExperienceContent] = useState('');
  const [experienceTags, setExperienceTags] = useState('');

  const runAction = async (id: string, action: () => Promise<TaskSpec>) => {
    setBusyId(id);
    try {
      onChanged(await action());
    } finally {
      setBusyId(null);
    }
  };

  const startEditing = (spec: TaskSpec) => {
    setEditingId(spec.id);
    setEditTitle(spec.title);
    setEditCommand(spec.command);
    setEditExecutionPayload(spec.execution_payload);
    setEditWorkdir(spec.remote_workdir);
    setEditTimeout(spec.timeout_seconds);
    setEditCriteria(spec.success_criteria.join('\n'));
  };

  const approve = (spec: TaskSpec) => {
    const scientificApproval = spec.approval_points.length
      ? `\n\n审批点：\n- ${spec.approval_points.join('\n- ')}`
      : '';
    const payloadReview = spec.execution_payload
      ? `\n\n绑定的执行载荷/LSF 脚本：\n${spec.execution_payload}\n\n请同时确认远端脚本文件内容与此快照一致。`
      : '';
    const confirmed = window.confirm(`批准以下命令进入可执行状态？\n\n目录：${spec.remote_workdir}\n命令：${spec.command}${payloadReview}${scientificApproval}\n\n批准不会立即执行，但桥接器之后可以执行该内容哈希。`);
    if (!confirmed) return;
    void runAction(spec.id, () => taskSpecsApi.approve(spec.id, 'approved', '用户在工作台确认完整目录与命令'));
  };

  const verify = (spec: TaskSpec, decision: 'completed' | 'failed' | 'blocked') => {
    const note = verificationNotes[spec.id]?.trim();
    if (!note) return;
    if (decision === 'completed') {
      const confirmed = window.confirm('确认当前执行证据满足此 Task Spec 的成功判据？这不会自动修改科学参数。');
      if (!confirmed) return;
    }
    void runAction(spec.id, () => taskSpecsApi.verify(spec.id, {
      decision,
      note,
      evidence: decision === 'completed'
        ? [{ kind: 'manual-verification', summary: note, source: 'Workbench user verification' }]
        : undefined,
    }));
  };

  const startExperience = (spec: TaskSpec) => {
    setExperienceSpecId(spec.id);
    setExperienceTitle(`${spec.title}：${statusLabels[spec.status]}经验`);
    setExperienceContent('');
    setExperienceTags('');
  };

  const saveExperience = async (spec: TaskSpec) => {
    if (!experienceTitle.trim() || !experienceContent.trim()) return;
    setBusyId(spec.id);
    try {
      const created = await experiencesApi.create({
        title: experienceTitle.trim(),
        content: experienceContent.trim(),
        tags: experienceTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
        source_task_spec_id: spec.id,
      });
      onChanged({ ...spec, experiences: [created, ...spec.experiences] });
      setExperienceSpecId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-[#2d2d44] pt-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6b6b80]">
        <ClipboardCheck size={11} /> Task Spec 编排记录
      </div>

      {specs.map(spec => {
        const latestRun = spec.runs.at(-1);
        const latestSchedulerJob = spec.scheduler_jobs.at(-1);
        const latestLogRead = latestSchedulerJob?.log_reads.at(-1);
        const canEdit = !['executing', 'monitoring', 'verifying', 'completed'].includes(spec.status);
        const auditedRunnerCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\\skills\\hpcplus-web-terminal\\scripts\\invoke-hpcplus-task-spec.ps1" -TaskSpecId "${spec.id}"`;
        const isBusy = busyId === spec.id;

        return (
          <div key={spec.id} className="rounded-lg border border-[#2d2d44] bg-[#111827]/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[#e2e2f0]">{spec.title}</span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] ${statusClasses[spec.status]}`}>
                {statusLabels[spec.status]}
              </span>
              <span className="rounded bg-[#252536] px-1.5 py-0.5 text-[9px] text-[#9898b0]">
                风险：{spec.risk_class}
              </span>
              {spec.command_hash && <span className="font-mono text-[9px] text-[#4a4a60]">#{spec.command_hash.slice(0, 10)}</span>}
            </div>

            {editingId === spec.id ? (
              <div className="mt-2 space-y-2">
                <input value={editTitle} onChange={event => setEditTitle(event.target.value)}
                  className="w-full rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                <input value={editWorkdir} onChange={event => setEditWorkdir(event.target.value)}
                  className="w-full rounded border border-[#383850] bg-[#0d1117] px-2 py-1 font-mono text-xs text-[#e2e2f0]" />
                <textarea value={editCommand} onChange={event => setEditCommand(event.target.value)} rows={3}
                  className="w-full resize-y rounded border border-[#383850] bg-[#0d1117] px-2 py-1 font-mono text-xs text-[#e2e2f0]" />
                <textarea value={editExecutionPayload} onChange={event => setEditExecutionPayload(event.target.value)} rows={6}
                  placeholder="完整执行载荷或 LSF 脚本快照；会进入风险检查和审批哈希"
                  className="w-full resize-y rounded border border-[#383850] bg-[#0d1117] px-2 py-1 font-mono text-xs text-[#e2e2f0]" />
                <textarea value={editCriteria} onChange={event => setEditCriteria(event.target.value)} rows={2}
                  placeholder="每行一个成功判据"
                  className="w-full resize-y rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                <label className="flex items-center gap-2 text-[10px] text-[#6b6b80]">
                  超时秒数
                  <input type="number" min={1} max={3600} value={editTimeout}
                    onChange={event => setEditTimeout(Number(event.target.value))}
                    className="w-20 rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                </label>
                <div className="flex gap-2">
                  <button disabled={isBusy} onClick={() => void runAction(spec.id, async () => {
                    const updated = await taskSpecsApi.update(spec.id, {
                      title: editTitle,
                      command: editCommand,
                      execution_payload: editExecutionPayload,
                      remote_workdir: editWorkdir,
                      timeout_seconds: editTimeout,
                      success_criteria: editCriteria.split('\n').map(item => item.trim()).filter(Boolean),
                    });
                    setEditingId(null);
                    return updated;
                  })} className="rounded bg-[#3b82f6] px-2 py-1 text-[10px] text-white disabled:opacity-50">保存并使旧审批失效</button>
                  <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-[10px] text-[#9898b0] hover:bg-[#252536]">取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-2 rounded border border-[#2d2d44] bg-[#0d1117] p-2 font-mono text-[10px] text-[#cbd5e1]">
                  <div className="mb-1 text-[#6b6b80]">cwd: {spec.remote_workdir}</div>
                  <div className="break-all">$ {spec.command}</div>
                </div>
                {spec.execution_payload && (
                  <details className="mt-2 rounded border border-[#f59e0b]/20 bg-[#f59e0b]/5 p-2 text-[10px] text-[#fbbf24]">
                    <summary className="cursor-pointer">审批绑定的完整执行载荷 / LSF 脚本</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[#cbd5e1]">{spec.execution_payload}</pre>
                    <p className="mt-2 text-[#f59e0b]/80">提交前必须确认远端脚本文件内容与此快照一致；任何修改都需要重新检查和审批。</p>
                  </details>
                )}
                <div className="mt-2 grid gap-2 text-[10px] text-[#6b6b80] md:grid-cols-2">
                  <div>输入文件：{spec.input_files.length ? spec.input_files.join('、') : '无'}</div>
                  <div>预期输出：{spec.expected_outputs.length ? spec.expected_outputs.join('、') : '未填写'}</div>
                  <div>工作流依赖：{spec.step_dependencies.length ? spec.step_dependencies.join('、') : '无'}</div>
                  <div>计划依赖：{spec.dependencies.length ? spec.dependencies.join('、') : '无'}</div>
                  <div>前置条件：{spec.preconditions.length ? spec.preconditions.join('；') : '无'}</div>
                  <div>科学检查：{spec.scientific_checks.length ? spec.scientific_checks.join('；') : '未填写'}</div>
                  <div>成功判据：{spec.success_criteria.length ? spec.success_criteria.join('；') : '未填写'}</div>
                  <div>人工审批点：{spec.approval_points.length ? spec.approval_points.join('；') : '无额外科学审批点'}</div>
                  <div>失败处理：{spec.failure_handling.length ? spec.failure_handling.join('；') : '按失败策略停止'}</div>
                  <div>超时：{spec.timeout_seconds}s；失败策略：{spec.failure_policy}</div>
                </div>
              </>
            )}

            {spec.blocked_reasons.length > 0 && (
              <div className="mt-2 flex items-start gap-1 text-[10px] text-[#f87171]">
                <ShieldAlert size={11} className="mt-0.5 shrink-0" /> {spec.blocked_reasons.join('、')}
              </div>
            )}

            {latestRun && (
              <div className="mt-2 rounded border border-[#2d2d44] bg-[#1a1a2e] px-2 py-1.5 text-[10px] text-[#9898b0]">
                第 {latestRun.attempt_no} 次执行：{latestRun.status}
                {latestRun.exit_code !== null && ` · exit ${latestRun.exit_code}`}
                {latestRun.output_summary && <div className="mt-1 whitespace-pre-wrap text-[#cbd5e1]">{latestRun.output_summary}</div>}
                {latestRun.verification_note && <div className="mt-1 text-[#4ade80]">验证：{latestRun.verification_note}</div>}
                {latestRun.evidence.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[#a78bfa]">验证证据（{latestRun.evidence.length}）</summary>
                    <ul className="mt-1 space-y-1 border-l border-[#8b5cf6]/20 pl-2">
                      {latestRun.evidence.map((item, index) => (
                        <li key={`${item.kind}-${index}`}>
                          <span className="text-[#c4b5fd]">{item.kind}</span>：{item.summary}
                          {item.source && <span className="text-[#4a4a60]"> · 来源：{item.source}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {latestSchedulerJob && (
              <div className="mt-2 rounded border border-[#0ea5e9]/20 bg-[#0c4a6e]/10 px-2 py-1.5 text-[10px] text-[#7dd3fc]">
                LSF Job &lt;{latestSchedulerJob.job_id}&gt;：{latestSchedulerJob.status}
                {latestSchedulerJob.last_polled_at && ` · 上次查询 ${new Date(latestSchedulerJob.last_polled_at).toLocaleString()}`}
                {latestSchedulerJob.next_poll_after && <div className="mt-1 text-[#6b6b80]">最早下次查询：{new Date(latestSchedulerJob.next_poll_after).toLocaleString()}</div>}
                {latestSchedulerJob.latest_summary && <div className="mt-1 whitespace-pre-wrap text-[#cbd5e1]">{latestSchedulerJob.latest_summary}</div>}
                <div className="mt-1 text-[#4a4a60]">轮询审计 {latestSchedulerJob.polls.length} 次；服务端强制间隔不少于 60 秒</div>
                {latestLogRead && (
                  <div className="mt-2 border-t border-[#0ea5e9]/15 pt-2 text-[#9898b0]">
                    有界日志 {latestLogRead.relative_path}（末尾 {latestLogRead.line_count} 行）：{latestLogRead.status}
                    {latestLogRead.output_summary && <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[#cbd5e1]">{latestLogRead.output_summary}</div>}
                  </div>
                )}
                {latestSchedulerJob.next_log_read_after && <div className="mt-1 text-[#4a4a60]">最早下次日志读取：{new Date(latestSchedulerJob.next_log_read_after).toLocaleString()}</div>}
              </div>
            )}

            {spec.status === 'unknown' && (
              <p className="mt-2 text-[10px] text-[#fb923c]">状态未知：禁止自动重试。请人工检查调度器和日志；确认后可编辑计划，生成新的内容哈希并重新审批。</p>
            )}

            {spec.experiences.length > 0 && (
              <div className="mt-2 rounded border border-[#8b5cf6]/20 bg-[#8b5cf6]/5 px-2 py-1.5 text-[10px] text-[#a78bfa]">
                已沉淀经验：{spec.experiences.map(experience => experience.title).join('；')}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {canEdit && editingId !== spec.id && (
                <button onClick={() => startEditing(spec)} className="flex items-center gap-1 rounded bg-[#252536] px-2 py-1 text-[10px] text-[#9898b0] hover:text-white">
                  <Edit3 size={10} /> 编辑
                </button>
              )}
              {spec.status === 'draft' && (
                <button disabled={isBusy} onClick={() => void runAction(spec.id, () => taskSpecsApi.check(spec.id))}
                  className="flex items-center gap-1 rounded bg-[#3b82f6] px-2 py-1 text-[10px] text-white disabled:opacity-50">
                  <ShieldAlert size={10} /> 检查风险与依赖
                </button>
              )}
              {spec.status === 'awaiting_approval' && (
                <>
                  <button disabled={isBusy} onClick={() => approve(spec)}
                    className="flex items-center gap-1 rounded bg-[#22c55e] px-2 py-1 text-[10px] text-white disabled:opacity-50">
                    <CheckCircle2 size={10} /> 批准此目录与命令
                  </button>
                  <button disabled={isBusy} onClick={() => void runAction(spec.id, () => taskSpecsApi.approve(spec.id, 'rejected', '用户拒绝执行'))}
                    className="flex items-center gap-1 rounded bg-[#ef4444]/20 px-2 py-1 text-[10px] text-[#f87171] disabled:opacity-50">
                    <XCircle size={10} /> 拒绝
                  </button>
                </>
              )}
              {spec.status === 'ready' && (
                <button onClick={() => navigator.clipboard.writeText(auditedRunnerCommand)}
                  className="flex items-center gap-1 rounded bg-[#252536] px-2 py-1 text-[10px] text-[#60a5fa] hover:text-white">
                  <Copy size={10} /> 复制审计执行器命令
                </button>
              )}
              {['completed', 'failed', 'unknown', 'blocked'].includes(spec.status) && experienceSpecId !== spec.id && (
                <button onClick={() => startExperience(spec)}
                  className="flex items-center gap-1 rounded bg-[#8b5cf6]/10 px-2 py-1 text-[10px] text-[#a78bfa] hover:bg-[#8b5cf6]/20">
                  <BookOpen size={10} /> 人工沉淀经验
                </button>
              )}
            </div>

            {experienceSpecId === spec.id && (
              <div className="mt-2 space-y-2 rounded border border-[#8b5cf6]/20 bg-[#8b5cf6]/5 p-2">
                <p className="text-[10px] text-[#a78bfa]">只记录经人工确认的事实、失败原因和可复用做法；不要把未验证推断写成结论。</p>
                <input value={experienceTitle} onChange={event => setExperienceTitle(event.target.value)}
                  placeholder="经验标题"
                  className="w-full rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                <textarea value={experienceContent} onChange={event => setExperienceContent(event.target.value)} rows={3}
                  placeholder="记录证据、判断、失败原因或下次应检查的事项"
                  className="w-full resize-y rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                <input value={experienceTags} onChange={event => setExperienceTags(event.target.value)}
                  placeholder="标签，用逗号分隔"
                  className="w-full rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                <div className="flex gap-2">
                  <button disabled={isBusy || !experienceTitle.trim() || !experienceContent.trim()}
                    onClick={() => void saveExperience(spec)}
                    className="rounded bg-[#8b5cf6] px-2 py-1 text-[10px] text-white disabled:opacity-50">保存并链接来源计划</button>
                  <button onClick={() => setExperienceSpecId(null)} className="rounded px-2 py-1 text-[10px] text-[#9898b0] hover:bg-[#252536]">取消</button>
                </div>
              </div>
            )}

            {spec.status === 'verifying' && (
              <div className="mt-2 space-y-2">
                <input value={verificationNotes[spec.id] ?? ''}
                  onChange={event => setVerificationNotes(previous => ({ ...previous, [spec.id]: event.target.value }))}
                  placeholder="填写验证结论或失败原因"
                  className="w-full rounded border border-[#383850] bg-[#0d1117] px-2 py-1 text-xs text-[#e2e2f0]" />
                <div className="flex gap-1.5">
                  <button disabled={isBusy || !(verificationNotes[spec.id]?.trim())} onClick={() => verify(spec, 'completed')}
                    className="rounded bg-[#22c55e] px-2 py-1 text-[10px] text-white disabled:opacity-50">验证通过</button>
                  <button disabled={isBusy || !(verificationNotes[spec.id]?.trim())} onClick={() => verify(spec, 'failed')}
                    className="rounded bg-[#ef4444]/20 px-2 py-1 text-[10px] text-[#f87171] disabled:opacity-50">验证失败</button>
                  <button disabled={isBusy || !(verificationNotes[spec.id]?.trim())} onClick={() => verify(spec, 'blocked')}
                    className="rounded bg-[#f59e0b]/20 px-2 py-1 text-[10px] text-[#fbbf24] disabled:opacity-50">阻塞等待人工</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
