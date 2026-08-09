import { useState, useCallback } from 'react';
import { CheckCircle2, Circle, Copy, Terminal, Edit3, Save, ChevronDown, ChevronRight, Upload, Download, Plus, Trash2 } from 'lucide-react';
import type { StepProgress, StepStatus, HpcConfig } from '../types';
import { useWorkflow, getStagesOf, getStepsOf } from '../contexts/WorkflowContext';
import { progressApi } from '../api/client';

interface Props {
  taskId: string;
  workflowId: string;
  taskName: string;
  hpcConfig: HpcConfig | null;
  progressMap: Record<string, StepProgress>;
  onProgressChanged: () => void;
}

function replacePlaceholders(text: string, cfg: HpcConfig, taskName: string, stageId: string): string {
  return text
    .replace(/\$\{REMOTE_PATH\}/g, cfg.remotePath)
    .replace(/\$\{TASK_NAME\}/g, taskName)
    .replace(/\$\{STAGE_ID\}/g, stageId)
    .replace(/\$\{MODULE_QE\}/g, cfg.moduleQE)
    .replace(/\$\{MODULE_WANNIER\}/g, cfg.moduleWannier)
    .replace(/\$\{MODULE_TRIQS\}/g, cfg.moduleTRIQS)
    .replace(/\$\{NPROCS\}/g, cfg.nprocs)
    .replace(/\$\{HOST\}/g, cfg.host)
    .replace(/\$\{USER\}/g, cfg.user);
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors ${
        copied ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#2d2d44] text-[#9898b0] hover:text-white hover:bg-[#383850]'
      }`}>
      <Copy size={10} />
      {copied ? '已复制!' : (label || '复制')}
    </button>
  );
}

export default function HpcWizard({ taskId, workflowId, taskName, hpcConfig, progressMap, onProgressChanged }: Props) {
  const workflow = useWorkflow(workflowId);
  const stages = getStagesOf(workflow);
  const steps = getStepsOf(workflow);
  const [editingScript, setEditingScript] = useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = useState('');
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set(steps.map(s => s.id)));
  const [editingCmds, setEditingCmds] = useState<string | null>(null);
  const [cmdDraft, setCmdDraft] = useState<string[]>([]);

  const toggleExpand = (stepId: string) => {
    setExpandedScripts(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleToggleStatus = useCallback(async (stepId: string, currentStatus: StepStatus) => {
    const newStatus: StepStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    await progressApi.upsert(taskId, stepId, { status: newStatus });
    onProgressChanged();
  }, [taskId, onProgressChanged]);

  const handleSaveScript = async (stepId: string) => {
    await progressApi.upsert(taskId, stepId, { lsf_script: scriptDraft });
    setEditingScript(null);
    onProgressChanged();
  };

  const handleSaveCmds = async (stepId: string) => {
    await progressApi.upsert(taskId, stepId, { commands: cmdDraft.filter(c => c.trim()) });
    setEditingCmds(null);
    onProgressChanged();
  };

  if (!hpcConfig || !hpcConfig.host) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <Terminal size={40} className="mx-auto text-[#383850] mb-3" />
          <p className="text-sm text-[#6b6b80] mb-2">未配置超算环境</p>
          <p className="text-xs text-[#4a4a60]">请在上方填写超算连接信息后查看提交向导</p>
        </div>
      </div>
    );
  }

  // Build wizard steps: prepend upload, append download
  const uploadCmd = `scp -r ${taskName} ${hpcConfig.user}@${hpcConfig.host}:${hpcConfig.remotePath}/`;
  const downloadCmd = `scp -r ${hpcConfig.user}@${hpcConfig.host}:${hpcConfig.remotePath}/${taskName}/check/* ./${taskName}/check/`;

  // Group steps by stage
  const stepsByStage = stages.map(stage => ({
    stage,
    steps: steps.filter(s => s.stageId === stage.id).sort((a, b) => a.order - b.order),
  }));

  let stepCounter = 0;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Upload step */}
      <div className="mb-4">
        <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Upload size={16} className="text-[#3b82f6] mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white mb-1">步骤 0: 上传文件到超算</div>
              <p className="text-xs text-[#9898b0] mb-3">将本地任务文件夹上传到超算远程目录</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-[#e2e2f0] bg-[#0d1117] rounded px-3 py-2 font-mono border border-[#2d2d44] break-all">
                  $ {uploadCmd}
                </code>
                <CopyButton text={uploadCmd} label="复制命令" />
              </div>
              <p className="text-[10px] text-[#f59e0b]/70 mt-2">在本地终端执行此命令，确保在项目工作目录下运行</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stage-grouped steps */}
      {stepsByStage.map(({ stage, steps: stageSteps }) => (
        <div key={stage.id} className="mb-4">
          {/* Stage header */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-1 h-4 rounded-full" style={{ background: stage.color }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: stage.color }}>{stage.name}</h3>
            <span className="text-[10px] text-[#4a4a60]">{stage.description}</span>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            {stageSteps.map((step) => {
              stepCounter++;
              const progress = progressMap[step.id];
              const status = progress?.status ?? 'pending';
              const isCompleted = status === 'completed';

              const effectiveLsf = progress?.lsf_script ?? step.lsfScript;
              const effectiveCommands = progress?.commands ?? step.commands ?? [];

              const resolvedLsf = effectiveLsf ? replacePlaceholders(effectiveLsf, hpcConfig, taskName, stage.id) : null;
              const resolvedCommands = effectiveCommands.map(cmd => replacePlaceholders(cmd, hpcConfig, taskName, stage.id));

              const isEditing = editingScript === step.id;
              const isExpanded = expandedScripts.has(step.id);

              return (
                <div key={step.id} className={`bg-[#1a1a2e] border rounded-xl p-4 transition-colors ${
                  isCompleted ? 'border-[#22c55e]/30' : 'border-[#2d2d44]'
                }`}>
                  <div className="flex items-start gap-3">
                    {/* Status checkbox */}
                    <button onClick={() => handleToggleStatus(step.id, status)}
                      className="mt-0.5 flex-shrink-0">
                      {isCompleted
                        ? <CheckCircle2 size={18} className="text-[#22c55e]" />
                        : <Circle size={18} className="text-[#4a4a60] hover:text-[#6b6b80]" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      {/* Title */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-[#4a4a60]">{stepCounter}</span>
                        <span className="text-sm font-medium text-white">{step.name}</span>
                        {step.optional && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#2d2d44] text-[#6b6b80]">可选</span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-xs text-[#9898b0] mb-2">{step.description}</p>

                      {/* Commands (always editable) */}
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] uppercase tracking-wider text-[#6b6b80]">命令</span>
                          {editingCmds !== step.id && (
                            <button onClick={() => { setEditingCmds(step.id); setCmdDraft([...effectiveCommands]); }}
                              className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                              <Edit3 size={10} /> {effectiveCommands.length > 0 ? '编辑' : '添加命令'}
                            </button>
                          )}
                        </div>
                        {editingCmds === step.id ? (
                          <div className="space-y-1.5">
                            {cmdDraft.map((cmd, i) => (
                              <div key={i} className="flex gap-1">
                                <span className="text-[10px] text-[#4a4a60] font-mono pt-1.5">$</span>
                                <input value={cmd} onChange={e => setCmdDraft(prev => prev.map((c, j) => j === i ? e.target.value : c))}
                                  className="flex-1 bg-[#0d1117] border border-[#2d2d44] rounded px-2 py-1 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]" />
                                <button onClick={() => setCmdDraft(prev => prev.filter((_, j) => j !== i))}
                                  className="p-1 text-[#6b6b80] hover:text-red-400 rounded hover:bg-[#2d2d44]">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                            <button onClick={() => setCmdDraft(prev => [...prev, ''])}
                              className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                              <Plus size={10} /> 添加命令
                            </button>
                            <div className="flex gap-2">
                              <button onClick={() => handleSaveCmds(step.id)}
                                className="flex items-center gap-1.5 px-3 py-1 bg-[#3b82f6] text-white text-xs rounded hover:bg-[#2563eb]">
                                <Save size={11} /> 保存
                              </button>
                              <button onClick={() => setEditingCmds(null)}
                                className="px-3 py-1 text-xs text-[#6b6b80] hover:text-white rounded hover:bg-[#2d2d44]">取消</button>
                            </div>
                            {cmdDraft.filter(c => c.trim()).length > 0 && (
                              <pre className="text-[10px] text-[#4ade80] bg-[#0d1117] rounded p-2 font-mono border border-[#22c55e]/20 whitespace-pre-wrap break-all">
                                {cmdDraft.filter(c => c.trim()).map(c => `$ ${replacePlaceholders(c, hpcConfig, taskName, stage.id)}`).join('\n')}
                              </pre>
                            )}
                          </div>
                        ) : resolvedCommands.length > 0 ? (
                          <div className="space-y-1">
                            {resolvedCommands.map((cmd, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <code className="flex-1 text-xs text-[#e2e2f0] bg-[#0d1117] rounded px-3 py-1.5 font-mono border border-[#2d2d44] break-all">
                                  $ {cmd}
                                </code>
                                <CopyButton text={cmd} />
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {/* LSF Script (optional, user can add to any step) */}
                      <div className="mb-2">
                        {effectiveLsf ? (
                          <>
                            <div className="flex items-center justify-between mb-1">
                              <button onClick={() => toggleExpand(step.id)}
                                className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                LSF 提交脚本
                                {progress?.lsf_script && <span className="text-[#f59e0b] ml-1">(已自定义)</span>}
                              </button>
                              <div className="flex items-center gap-1">
                                {!isEditing && (
                                  <button onClick={() => { setEditingScript(step.id); setScriptDraft(effectiveLsf); }}
                                    className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                                    <Edit3 size={10} /> 编辑
                                  </button>
                                )}
                                <CopyButton text={resolvedLsf!} label="复制脚本" />
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea value={scriptDraft} onChange={e => setScriptDraft(e.target.value)}
                                  className="w-full bg-[#0d1117] border border-[#2d2d44] rounded-lg p-3 text-xs text-[#e2e2f0] font-mono resize-none focus:outline-none focus:border-[#3b82f6]"
                                  rows={10} />
                                <div className="flex gap-2">
                                  <button onClick={() => handleSaveScript(step.id)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
                                    <Save size={12} /> 保存
                                  </button>
                                  <button onClick={() => setEditingScript(null)}
                                    className="px-3 py-1.5 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
                                </div>
                                <p className="text-[10px] text-[#4a4a60]">编辑模板源码，保存后自动替换占位符。下方为替换预览：</p>
                                <pre className="text-[10px] text-[#4ade80] bg-[#0d1117] rounded-lg p-2 font-mono border border-[#22c55e]/20 overflow-x-auto whitespace-pre-wrap break-all">
                                  {replacePlaceholders(scriptDraft, hpcConfig, taskName, stage.id)}
                                </pre>
                              </div>
                            ) : isExpanded ? (
                              <pre className="text-xs text-[#e2e2f0] bg-[#0d1117] rounded-lg p-3 font-mono border border-[#2d2d44] overflow-x-auto whitespace-pre-wrap break-all">
                                {resolvedLsf}
                              </pre>
                            ) : (
                              <pre className="text-[10px] text-[#6b6b80] bg-[#0d1117] rounded px-3 py-2 font-mono border border-[#2d2d44] overflow-hidden whitespace-pre max-h-10">
                                {resolvedLsf!.split('\n').slice(0, 2).join('\n')}...
                              </pre>
                            )}

                            {!isEditing && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] text-[#6b6b80]">提交命令:</span>
                                <code className="text-xs text-[#e2e2f0] bg-[#0d1117] rounded px-2 py-1 font-mono border border-[#2d2d44]">
                                  bsub &lt; {step.id}.lsf
                                </code>
                                <CopyButton text={`bsub < ${step.id}.lsf`} label="复制" />
                              </div>
                            )}
                          </>
                        ) : (
                          editingScript === step.id ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] uppercase tracking-wider text-[#6b6b80]">LSF 提交脚本</span>
                              </div>
                              <textarea value={scriptDraft} onChange={e => setScriptDraft(e.target.value)}
                                className="w-full bg-[#0d1117] border border-[#2d2d44] rounded-lg p-3 text-xs text-[#e2e2f0] font-mono resize-none focus:outline-none focus:border-[#3b82f6]"
                                rows={10} />
                              <div className="flex gap-2">
                                <button onClick={() => handleSaveScript(step.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
                                  <Save size={12} /> 保存
                                </button>
                                <button onClick={() => setEditingScript(null)}
                                  className="px-3 py-1.5 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
                              </div>
                              <p className="text-[10px] text-[#4a4a60]">可用占位符: $&#123;REMOTE_PATH&#125; $&#123;TASK_NAME&#125; $&#123;STAGE_ID&#125; $&#123;NPROCS&#125; $&#123;MODULE_QE&#125; 等</p>
                              {scriptDraft.trim() && (
                                <pre className="text-[10px] text-[#4ade80] bg-[#0d1117] rounded-lg p-2 font-mono border border-[#22c55e]/20 overflow-x-auto whitespace-pre-wrap break-all">
                                  {replacePlaceholders(scriptDraft, hpcConfig, taskName, stage.id)}
                                </pre>
                              )}
                            </div>
                          ) : (
                            <button onClick={() => {
                              setEditingScript(step.id);
                              setScriptDraft(`#BSUB -J ${`$`}{TASK_NAME}_${`$`}{STAGE_ID}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 1:00
#BSUB -o job.out
#BSUB -e job.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/${`$`}{STAGE_ID}
module load ${`$`}{MODULE_QE}
# Your command here`);
                            }}
                              className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                              <Plus size={10} /> 添加 LSF 脚本
                            </button>
                          )
                        )}
                      </div>

                      {/* Tips */}
                      {step.tips && (
                        <p className="text-[10px] text-[#f59e0b]/70 mt-2 flex items-start gap-1">
                          <span>💡</span> {step.tips}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Download step */}
      <div className="mb-4">
        <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Download size={16} className="text-[#22c55e] mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white mb-1">最后一步: 下载结果到本地</div>
              <p className="text-xs text-[#9898b0] mb-3">将超算上的计算结果下载回本地</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-[#e2e2f0] bg-[#0d1117] rounded px-3 py-2 font-mono border border-[#2d2d44] break-all">
                  $ {downloadCmd}
                </code>
                <CopyButton text={downloadCmd} label="复制命令" />
              </div>
              <p className="text-[10px] text-[#f59e0b]/70 mt-2">在本地终端执行，下载 check 阶段的结果文件</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
