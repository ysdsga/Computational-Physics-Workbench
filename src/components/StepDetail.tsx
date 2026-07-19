import { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle2, Circle, SkipForward, PlayCircle, Save, Plus, Trash2, FileText, Folder, Eye, Link2, Unlink, Edit3 } from 'lucide-react';
import type { WorkflowStep, StepStatus, StepProgress, StepFile, FileEntry } from '../types';
import { useWorkflow, getStageForStepOf } from '../contexts/WorkflowContext';
import { progressApi, stepFilesApi, filesApi } from '../api/client';
import ScientificContract from './ScientificContract';

interface Props {
  step: WorkflowStep;
  taskId: string;
  workflowId: string;
  projectId: string;
  taskFolderName: string;
  progress: StepProgress | undefined;
  onClose: () => void;
  onProgressChanged: () => void;
}

export default function StepDetail({ step, taskId, workflowId, projectId, taskFolderName, progress, onClose, onProgressChanged }: Props) {
  const workflow = useWorkflow(workflowId);
  const stage = getStageForStepOf(workflow, step.id);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState(progress?.notes ?? '');

  // Commands editing
  const templateCommands = step.commands ?? [];
  const savedCommands = progress?.commands;
  const effectiveCommands = savedCommands ?? templateCommands;
  const [editingCmds, setEditingCmds] = useState(false);
  const [cmdDraft, setCmdDraft] = useState<string[]>([]);

  // Stage folder path (shared by all steps in the same stage)
  const stageFolderPath = stage ? `${taskFolderName}/${stage.id}` : '';
  const [folderEntries, setFolderEntries] = useState<FileEntry[]>([]);
  const [folderExists, setFolderExists] = useState(true);
  const [associatedFiles, setAssociatedFiles] = useState<StepFile[]>([]);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);

  const loadStepData = useCallback(async () => {
    // Load associated files
    try {
      const f = await stepFilesApi.list(taskId, step.id);
      setAssociatedFiles(f);
    } catch { /* ignore */ }

    // Load step folder contents
    if (stageFolderPath) {
      try {
        const res = await filesApi.browse(projectId, stageFolderPath);
        setFolderEntries(res.entries);
        setFolderExists(res.exists);
      } catch {
        setFolderExists(false);
      }
    }
  }, [taskId, step.id, projectId, stageFolderPath]);

  useEffect(() => { loadStepData(); }, [loadStepData]);

  const statusActions: { status: StepStatus; icon: typeof CheckCircle2; label: string; color: string }[] = [
    { status: 'pending',    icon: Circle,      label: '待开始', color: '#6b6b80' },
    { status: 'in_progress',icon: PlayCircle,   label: '进行中', color: '#3b82f6' },
    { status: 'completed',  icon: CheckCircle2, label: '已完成', color: '#22c55e' },
    { status: 'skipped',    icon: SkipForward,  label: '跳过',   color: '#6b6b80' },
  ];

  const handleSetStatus = async (status: StepStatus) => {
    await progressApi.upsert(taskId, step.id, { status });
    onProgressChanged();
  };

  const handleSaveNote = async () => {
    await progressApi.upsert(taskId, step.id, { notes: noteDraft });
    setEditingNotes(false);
    onProgressChanged();
  };

  // === Command editing ===
  const startEditCmds = () => {
    setCmdDraft([...effectiveCommands]);
    setEditingCmds(true);
  };

  const handleSaveCmds = async () => {
    await progressApi.upsert(taskId, step.id, { commands: cmdDraft.filter(c => c.trim()) });
    setEditingCmds(false);
    onProgressChanged();
  };

  // === File association ===
  const isFileAssociated = (entry: FileEntry): StepFile | undefined => {
    return associatedFiles.find(f => f.file_name === entry.name || f.file_path.endsWith(entry.relativePath));
  };

  const handleToggleAssociate = async (entry: FileEntry) => {
    const existing = isFileAssociated(entry);
    if (existing) {
      // Unlink
      await stepFilesApi.remove(existing.id);
    } else {
      // Link
      await stepFilesApi.add(taskId, step.id, {
        file_path: entry.relativePath,
        file_name: entry.name,
      });
    }
    loadStepData();
  };

  const handleViewFile = async (entry: FileEntry) => {
    try {
      const res = await filesApi.read(projectId, entry.relativePath);
      setViewingFile({ name: res.name, content: res.content });
    } catch (e) {
      setViewingFile({ name: entry.name, content: `[无法读取文件: ${(e as Error).message}]` });
    }
  };

  const hasCustomCommands = savedCommands !== undefined;

  return (
    <div className="w-96 bg-[#1a1a2e] border-l border-[#2d2d44] flex flex-col flex-shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d2d44]">
        <div className="flex items-center gap-2 min-w-0">
          {stage && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ background: stage.colorBg, color: stage.color, border: `1px solid ${stage.colorBorder}` }}>
              {stage.name}
            </span>
          )}
          <h3 className="text-sm font-semibold text-white truncate">{step.name}</h3>
          {step.optional && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2d2d44] text-[#6b6b80] flex-shrink-0">可选</span>
          )}
        </div>
        <button onClick={onClose} className="text-[#6b6b80] hover:text-white p-1 rounded hover:bg-[#2d2d44]">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-2 block">状态</label>
          <div className="grid grid-cols-4 gap-1.5">
            {statusActions.map(({ status, icon: Icon, label, color }) => (
              <button key={status} onClick={() => handleSetStatus(status)}
                className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] transition-colors ${
                  (progress?.status ?? 'pending') === status
                    ? 'bg-[#252536] border border-[#383850] text-white'
                    : 'text-[#6b6b80] hover:bg-[#252536] border border-transparent'
                }`}>
                <Icon size={16} style={{ color: (progress?.status ?? 'pending') === status ? color : undefined }} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">说明</label>
          <p className="text-sm text-[#9898b0] leading-relaxed bg-[#252536] rounded-lg p-3">{step.description}</p>
        </div>

        <ScientificContract step={step} />

        {/* Input/Output Files (template hints) */}
        {step.inputFiles && step.inputFiles.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">需要准备的文件</label>
            <div className="space-y-1">
              {step.inputFiles.map((f, i) => (
                <div key={i} className="text-xs text-[#9898b0] bg-[#252536] rounded px-3 py-1.5 font-mono">{f}</div>
              ))}
            </div>
          </div>
        )}
        {step.outputFiles && step.outputFiles.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">预期输出文件</label>
            <div className="space-y-1">
              {step.outputFiles.map((f, i) => (
                <div key={i} className="text-xs text-[#22c55e]/70 bg-[#1a2e1a]/30 rounded px-3 py-1.5 font-mono">{f}</div>
              ))}
            </div>
          </div>
        )}

        {/* Commands — editable */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">
              Shell 命令
              {hasCustomCommands && <span className="ml-1.5 text-[#f59e0b]">(已自定义)</span>}
            </label>
            {!editingCmds && effectiveCommands.length > 0 && (
              <button onClick={startEditCmds} className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                <Edit3 size={10} /> 编辑
              </button>
            )}
          </div>
          {editingCmds ? (
            <div className="space-y-2">
              {cmdDraft.map((cmd, i) => (
                <div key={i} className="flex gap-1">
                  <span className="text-xs text-[#4a4a60] font-mono pt-1.5">$</span>
                  <input value={cmd} onChange={e => setCmdDraft(prev => prev.map((c, j) => j === i ? e.target.value : c))}
                    className="flex-1 bg-[#0d1117] border border-[#2d2d44] rounded px-2 py-1.5 text-xs text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]" />
                  <button onClick={() => setCmdDraft(prev => prev.filter((_, j) => j !== i))}
                    className="p-1.5 text-[#6b6b80] hover:text-red-400 rounded hover:bg-[#2d2d44]">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button onClick={() => setCmdDraft(prev => [...prev, ''])}
                className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                <Plus size={11} /> 添加命令
              </button>
              <div className="flex gap-2">
                <button onClick={handleSaveCmds}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
                  <Save size={12} /> 保存
                </button>
                <button onClick={() => setEditingCmds(false)}
                  className="px-3 py-1.5 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
              </div>
            </div>
          ) : effectiveCommands.length > 0 ? (
            <div className="space-y-1">
              {effectiveCommands.map((cmd, i) => (
                <div key={i} className="text-xs text-[#e2e2f0] bg-[#0d1117] rounded px-3 py-1.5 font-mono border border-[#2d2d44]">
                  $ {cmd}
                </div>
              ))}
            </div>
          ) : (
            <button onClick={startEditCmds} className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
              <Plus size={11} /> 添加命令
            </button>
          )}
        </div>

        {/* Tips */}
        {step.tips && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">提示</label>
            <p className="text-xs text-[#f59e0b]/80 bg-[#f59e0b]/5 rounded-lg p-3 border border-[#f59e0b]/10 leading-relaxed">{step.tips}</p>
          </div>
        )}

        {/* Substeps */}
        {step.substeps && step.substeps.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">子步骤</label>
            <div className="space-y-2">
              {step.substeps.map(sub => (
                <div key={sub.id} className="bg-[#252536] rounded-lg p-3">
                  <div className="text-xs font-medium text-white mb-1">{sub.name}</div>
                  <div className="text-xs text-[#9898b0] leading-relaxed">{sub.description}</div>
                  {sub.files && sub.files.length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {sub.files.map((f, i) => (
                        <span key={i} className="text-[10px] text-[#3b82f6]/70 bg-[#3b82f6]/5 px-1.5 py-0.5 rounded font-mono">{f}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step folder files — linked to file repository */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">
            阶段文件夹
          </label>
          <div className="text-[10px] text-[#6b6b80] font-mono bg-[#252536] rounded px-2 py-1 mb-2 break-all">
            {stageFolderPath || '(未确定)'}
          </div>
          {!folderExists ? (
            <p className="text-xs text-[#4a4a60] italic">文件夹尚未创建（创建任务时自动生成）</p>
          ) : folderEntries.length === 0 ? (
            <p className="text-xs text-[#4a4a60] italic">空文件夹，将计算文件放入此目录后会自动显示</p>
          ) : (
            <div className="space-y-0.5">
              {folderEntries.map((entry, i) => {
                const linked = isFileAssociated(entry);
                return (
                  <div key={i} className="flex items-center gap-2 bg-[#252536] rounded-lg px-3 py-2 group hover:bg-[#2d2d44]">
                    {entry.isDirectory
                      ? <Folder size={13} className="text-[#f59e0b] flex-shrink-0" />
                      : <FileText size={13} className={linked ? 'text-[#22c55e] flex-shrink-0' : 'text-[#3b82f6] flex-shrink-0'} />}
                    <button onClick={() => !entry.isDirectory && handleViewFile(entry)}
                      className="text-xs text-[#e2e2f0] flex-1 text-left truncate hover:text-white disabled:cursor-default"
                      disabled={entry.isDirectory}>
                      {entry.name}
                    </button>
                    {!entry.isDirectory && (
                      <>
                        <span className="text-[9px] text-[#4a4a60] flex-shrink-0">
                          {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(1)}K`}
                        </span>
                        <button onClick={() => handleToggleAssociate(entry)}
                          className={`p-1 rounded hover:bg-[#383850] ${linked ? 'text-[#22c55e]' : 'text-[#6b6b80] hover:text-[#3b82f6]'}`}
                          title={linked ? '取消关联' : '关联到此步骤'}>
                          {linked ? <Unlink size={12} /> : <Link2 size={12} />}
                        </button>
                        <button onClick={() => handleViewFile(entry)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#6b6b80] hover:text-white rounded hover:bg-[#383850]">
                          <Eye size={12} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Show associated files that may not be in the folder */}
          {associatedFiles.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[#6b6b80] mb-1">已关联文件 ({associatedFiles.length})</div>
              <div className="space-y-0.5">
                {associatedFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-2 bg-[#1a2e1a]/30 rounded px-2 py-1 group">
                    <FileText size={11} className="text-[#22c55e] flex-shrink-0" />
                    <span className="text-[10px] text-[#9898b0] flex-1 truncate">{f.file_name}</span>
                    <button onClick={() => stepFilesApi.remove(f.id).then(() => loadStepData())}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[#6b6b80] hover:text-red-400 rounded">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1.5 block">笔记</label>
          {editingNotes ? (
            <div className="space-y-2">
              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                className="w-full bg-[#252536] border border-[#383850] rounded-lg p-3 text-sm text-[#e2e2f0] resize-none focus:outline-none focus:border-[#3b82f6] placeholder-[#4a4a60]"
                rows={4} placeholder="记录这一步的注意事项、遇到的问题..." />
              <div className="flex gap-2">
                <button onClick={handleSaveNote}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
                  <Save size={12} /> 保存
                </button>
                <button onClick={() => { setNoteDraft(progress?.notes ?? ''); setEditingNotes(false); }}
                  className="px-3 py-1.5 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
              </div>
            </div>
          ) : (
            <div onClick={() => setEditingNotes(true)}
              className="text-sm text-[#9898b0] bg-[#252536] rounded-lg p-3 cursor-pointer hover:bg-[#2d2d44] min-h-[40px]">
              {progress?.notes || <span className="text-[#4a4a60] italic">点击添加笔记...</span>}
            </div>
          )}
        </div>

        {progress?.updated_at && (
          <div className="text-[10px] text-[#4a4a60]">最后更新: {new Date(progress.updated_at).toLocaleString('zh-CN')}</div>
        )}
      </div>

      {/* File viewer modal */}
      {viewingFile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setViewingFile(null)}>
          <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl w-[700px] h-[600px] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d2d44]">
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-[#3b82f6]" />
                <h3 className="text-sm font-medium text-white">{viewingFile.name}</h3>
              </div>
              <button onClick={() => setViewingFile(null)} className="text-[#6b6b80] hover:text-white p-1 rounded hover:bg-[#2d2d44]">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs text-[#e2e2f0] font-mono whitespace-pre-wrap break-all">{viewingFile.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
