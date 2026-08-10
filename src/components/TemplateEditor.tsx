import { useState, useEffect, useCallback } from 'react';
import { X, Save, RotateCcw, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { useWorkflowContext } from '../contexts/WorkflowContext';
import type { WorkflowTemplate, WorkflowStage, WorkflowStep, WorkflowSubStep } from '../types';

interface Props {
  workflowId?: string;
  workflow?: WorkflowTemplate;
  mode?: 'template' | 'task';
  onSave?: (workflow: WorkflowTemplate) => Promise<void>;
  onClose: () => void;
}

const PRESET_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];

export default function TemplateEditor({ workflowId, workflow, mode = 'template', onSave, onClose }: Props) {
  const { workflows, saveTemplate, resetTemplate } = useWorkflowContext();
  const original = workflow ?? workflows.find(w => w.id === workflowId);
  const isTaskWorkflow = mode === 'task';

  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // Deep clone from original on mount / when original changes
  useEffect(() => {
    if (original) {
      setStages(JSON.parse(JSON.stringify(original.stages)));
      setSteps(JSON.parse(JSON.stringify(original.steps)));
      setName(original.name);
      setDescription(original.description);
      setDirty(false);
    }
  }, [original]);

  // Track dirty state
  const checkDirty = useCallback((newStages: WorkflowStage[], newSteps: WorkflowStep[]) => {
    if (!original) return;
    const changed = JSON.stringify(newStages) !== JSON.stringify(original.stages) ||
                    JSON.stringify(newSteps) !== JSON.stringify(original.steps) ||
                    name !== original.name || description !== original.description;
    setDirty(changed);
  }, [original, name, description]);

  // === Stage operations ===
  const updateStage = (stageId: string, patch: Partial<WorkflowStage>) => {
    const next = stages.map(s => s.id === stageId ? { ...s, ...patch } : s);
    setStages(next); checkDirty(next, steps);
  };
  const addStage = () => {
    const id = `stage-${Date.now()}`;
    const color = PRESET_COLORS[stages.length % PRESET_COLORS.length];
    const next = [...stages, { id, name: '新阶段', color, colorBg: hexToRgba(color, 0.12), colorBorder: hexToRgba(color, 0.4), description: '' }];
    setStages(next); checkDirty(next, steps);
  };
  const deleteStage = (stageId: string) => {
    const stage = stages.find(s => s.id === stageId);
    const stepCount = steps.filter(s => s.stageId === stageId).length;
    setConfirm({
      title: '删除阶段',
      message: `确定要删除阶段「${stage?.name}」吗？${stepCount > 0 ? `\n\n该阶段下有 ${stepCount} 个步骤，将一并删除。` : ''}\n\n此操作不可撤销，保存后生效。`,
      onConfirm: () => {
        const nextStages = stages.filter(s => s.id !== stageId);
        const nextSteps = steps.filter(s => s.stageId !== stageId);
        setStages(nextStages); setSteps(nextSteps); checkDirty(nextStages, nextSteps);
        setConfirm(null);
      },
    });
  };

  // === Step operations ===
  const updateStep = (stepId: string, patch: Partial<WorkflowStep>) => {
    const next = steps.map(s => s.id === stepId ? { ...s, ...patch } : s);
    setSteps(next); checkDirty(stages, next);
  };
  const addStep = (stageId: string) => {
    const stageSteps = steps.filter(s => s.stageId === stageId);
    const order = stageSteps.length + 1;
    const id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = [...steps, { id, stageId, order, name: '新步骤', description: '' }];
    setSteps(next); checkDirty(stages, next);
    setExpandedSteps(prev => new Set(prev).add(id));
  };
  const deleteStep = (stepId: string) => {
    const step = steps.find(s => s.id === stepId);
    setConfirm({
      title: '删除步骤',
      message: `确定要删除步骤「${step?.name}」吗？\n\n此操作不可撤销，保存后生效。`,
      onConfirm: () => {
        const next = steps.filter(s => s.id !== stepId);
        setSteps(next); checkDirty(stages, next);
        setConfirm(null);
      },
    });
  };

  // === Substep operations ===
  const updateSubstep = (stepId: string, subId: string, patch: Partial<WorkflowSubStep>) => {
    const step = steps.find(s => s.id === stepId);
    if (!step?.substeps) return;
    const substeps = step.substeps.map(sub => sub.id === subId ? { ...sub, ...patch } : sub);
    updateStep(stepId, { substeps });
  };
  const addSubstep = (stepId: string) => {
    const step = steps.find(s => s.id === stepId);
    const substeps = step?.substeps ? [...step.substeps] : [];
    const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    substeps.push({ id, name: '新子步骤', description: '' });
    updateStep(stepId, { substeps });
  };
  const deleteSubstep = (stepId: string, subId: string) => {
    const step = steps.find(s => s.id === stepId);
    if (!step?.substeps) return;
    const sub = step.substeps.find(s => s.id === subId);
    setConfirm({
      title: '删除子步骤',
      message: `确定要删除子步骤「${sub?.name}」吗？`,
      onConfirm: () => {
        const substeps = step.substeps!.filter(s => s.id !== subId);
        updateStep(stepId, { substeps });
        setConfirm(null);
      },
    });
  };

  // === Array field helpers (commands, inputFiles, outputFiles) ===
  const updateArrayField = (stepId: string, field: 'commands' | 'inputFiles' | 'outputFiles', value: string[]) => {
    updateStep(stepId, { [field]: value } as Partial<WorkflowStep>);
  };

  // === Save ===
  const handleSave = () => {
    setConfirm({
      title: isTaskWorkflow ? '保存任务流程' : '保存模板',
      message: isTaskWorkflow
        ? `确定要保存当前任务的工作流修改吗？\n\n修改只影响这个任务，不会改变原始模板或其他任务。已有计算目录和进度数据不会被删除。`
        : `确定要保存对工作流模板的修改吗？\n\n修改只影响之后新创建的任务，已有任务仍使用各自的独立工作流。`,
      onConfirm: async () => {
        setSaving(true);
        try {
          if (!original) return;
          const nextWorkflow = { id: original.id, name, description, stages, steps };
          if (isTaskWorkflow) {
            if (!onSave) throw new Error('Task workflow save handler is missing');
            await onSave(nextWorkflow);
          } else {
            await saveTemplate(original.id, { name, description, stages, steps });
          }
          setConfirm(null);
          setDirty(false);
        } catch (err) {
          alert('保存失败: ' + (err as Error).message);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  // === Reset ===
  const handleReset = () => {
    setConfirm({
      title: '重置为默认模板',
      message: `⚠️ 警告：这将丢弃所有自定义修改，恢复为内置默认模板。\n\n此操作不可撤销！确定继续吗？`,
      onConfirm: async () => {
        try {
          if (!original) return;
          await resetTemplate(original.id);
          setConfirm(null);
        } catch (err) {
          alert('重置失败: ' + (err as Error).message);
        }
      },
    });
  };

  // === Close with unsaved check ===
  const handleClose = () => {
    if (dirty) {
      setConfirm({
        title: '有未保存的修改',
        message: '你有未保存的修改，确定要关闭编辑器吗？所有更改将丢失。',
        onConfirm: () => { setConfirm(null); onClose(); },
      });
    } else {
      onClose();
    }
  };

  const toggleExpand = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId); else next.add(stepId);
      return next;
    });
  };

  if (!original) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0d1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2d2d44] bg-[#1a1a2e] flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">{isTaskWorkflow ? '编辑任务工作流' : '编辑工作流模板'}</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6]/80 border border-[#8b5cf6]/20">{name}</span>
          {dirty && <span className="text-[10px] text-[#f59e0b] flex items-center gap-1"><AlertTriangle size={11} /> 未保存</span>}
        </div>
        <div className="flex items-center gap-2">
          {!isTaskWorkflow && (
            <button onClick={handleReset} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#f59e0b] hover:bg-[#f59e0b]/10 rounded-lg transition-colors">
              <RotateCcw size={12} /> 重置为默认
            </button>
          )}
          <button onClick={handleSave} disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#3b82f6] text-white hover:bg-[#2563eb] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Save size={12} /> {saving ? '保存中...' : '保存'}
          </button>
          <button onClick={handleClose} className="p-1.5 text-[#6b6b80] hover:text-white hover:bg-[#2d2d44] rounded-lg">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Warning banner */}
      <div className="px-5 py-2 bg-[#f59e0b]/5 border-b border-[#f59e0b]/15 flex items-center gap-2 flex-shrink-0">
        <AlertTriangle size={13} className="text-[#f59e0b] flex-shrink-0" />
        <p className="text-[10px] text-[#f59e0b]/80">
          {isTaskWorkflow
            ? '这是当前任务的独立工作流。修改不会影响原始模板或其他任务；删除流程节点也不会删除已有计算文件和历史进度。'
            : '修改模板只影响之后新创建的任务，已有任务的独立工作流不会变化。删除操作需确认。'}
        </p>
      </div>

      {/* Workflow meta editor */}
      <div className="px-5 py-3 border-b border-[#2d2d44] bg-[#1a1a2e] flex-shrink-0">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">{isTaskWorkflow ? '流程名称' : '模板名称'}</label>
            <input value={name} onChange={e => { setName(e.target.value); setDirty(true); }}
              className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-1.5 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]" />
          </div>
          <div className="flex-[2]">
            <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">{isTaskWorkflow ? '流程描述' : '模板描述'}</label>
            <input value={description} onChange={e => { setDescription(e.target.value); setDirty(true); }}
              className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-1.5 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]" />
          </div>
        </div>
      </div>

      {/* Stages & Steps editor body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {stages.map((stage, stageIdx) => {
          const stageSteps = steps.filter(s => s.stageId === stage.id).sort((a, b) => a.order - b.order);
          return (
            <div key={stage.id} className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl overflow-hidden">
              {/* Stage header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2d2d44]" style={{ background: stage.colorBg }}>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[#6b6b80] text-xs font-mono">#{stageIdx + 1}</span>
                  <input value={stage.name} onChange={e => updateStage(stage.id, { name: e.target.value })}
                    className="bg-transparent border-none text-sm font-semibold text-white focus:outline-none focus:bg-[#252536] rounded px-2 py-1 min-w-[120px]" />
                  <input value={stage.description} onChange={e => updateStage(stage.id, { description: e.target.value })}
                    placeholder="阶段描述..."
                    className="bg-transparent border-none text-xs text-[#9898b0] focus:outline-none focus:bg-[#252536] rounded px-2 py-1 flex-1" />
                </div>
                {/* Color picker */}
                <div className="flex items-center gap-1">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => updateStage(stage.id, { color: c, colorBg: hexToRgba(c, 0.12), colorBorder: hexToRgba(c, 0.4) })}
                      className={`w-4 h-4 rounded-full border-2 transition-transform ${stage.color === c ? 'scale-125 border-white' : 'border-transparent hover:scale-110'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <button onClick={() => deleteStage(stage.id)}
                  className="p-1.5 text-[#ef4444]/60 hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded-lg transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Steps */}
              <div className="p-3 space-y-2">
                {stageSteps.map((step, stepIdx) => {
                  const expanded = expandedSteps.has(step.id);
                  return (
                    <div key={step.id} className="bg-[#252536] border border-[#383850] rounded-lg overflow-hidden">
                      {/* Step header (always visible) */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button onClick={() => toggleExpand(step.id)} className="text-[#6b6b80] hover:text-white">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <span className="text-[#6b6b80] text-[10px] font-mono">{stepIdx + 1}.</span>
                        <input value={step.name} onChange={e => updateStep(step.id, { name: e.target.value })}
                          className="bg-transparent border-none text-sm text-white focus:outline-none focus:bg-[#1a1a2e] rounded px-2 py-1 flex-1" />
                        <label className="flex items-center gap-1 text-[10px] text-[#6b6b80] cursor-pointer">
                          <input type="checkbox" checked={step.optional ?? false}
                            onChange={e => updateStep(step.id, { optional: e.target.checked })}
                            className="accent-[#3b82f6]" />
                          可选
                        </label>
                        <button onClick={() => deleteStep(step.id)}
                          className="p-1 text-[#ef4444]/50 hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded">
                          <Trash2 size={12} />
                        </button>
                      </div>

                      {/* Step detail (expandable) */}
                      {expanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-[#383850] pt-3">
                          <Field label="描述">
                            <textarea value={step.description} onChange={e => updateStep(step.id, { description: e.target.value })}
                              rows={2} className="w-full bg-[#1a1a2e] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0] resize-none focus:outline-none focus:border-[#3b82f6]" />
                          </Field>
                          <Field label="提示 (tips)">
                            <textarea value={step.tips ?? ''} onChange={e => updateStep(step.id, { tips: e.target.value })}
                              rows={2} placeholder="可选的提示信息..."
                              className="w-full bg-[#1a1a2e] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0] resize-none focus:outline-none focus:border-[#3b82f6]" />
                          </Field>
                          <ArrayField label="Shell 命令" values={step.commands ?? []}
                            onChange={v => updateArrayField(step.id, 'commands', v)} placeholder="mpirun -np 4 pw.x < scf.in > scf.out" />
                          <ArrayField label="输入文件" values={step.inputFiles ?? []}
                            onChange={v => updateArrayField(step.id, 'inputFiles', v)} placeholder="scf.in" />
                          <ArrayField label="输出文件" values={step.outputFiles ?? []}
                            onChange={v => updateArrayField(step.id, 'outputFiles', v)} placeholder="scf.out" />
                          <Field label="LSF 脚本模板">
                            <textarea value={step.lsfScript ?? ''} onChange={e => updateStep(step.id, { lsfScript: e.target.value })}
                              rows={6} placeholder="#BSUB -J job_name..."
                              className="w-full bg-[#0d1117] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0] font-mono resize-none focus:outline-none focus:border-[#3b82f6]" />
                          </Field>

                          {/* Substeps */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-[10px] uppercase tracking-wider text-[#6b6b80]">子步骤</label>
                              <button onClick={() => addSubstep(step.id)}
                                className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
                                <Plus size={11} /> 添加子步骤
                              </button>
                            </div>
                            {step.substeps && step.substeps.length > 0 ? (
                              <div className="space-y-2">
                                {step.substeps.map(sub => (
                                  <div key={sub.id} className="bg-[#1a1a2e] border border-[#383850] rounded-lg p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <input value={sub.name} onChange={e => updateSubstep(step.id, sub.id, { name: e.target.value })}
                                        className="bg-transparent border-none text-xs font-medium text-white focus:outline-none focus:bg-[#252536] rounded px-2 py-1 flex-1" />
                                      <button onClick={() => deleteSubstep(step.id, sub.id)}
                                        className="p-1 text-[#ef4444]/50 hover:text-[#ef4444] rounded">
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                    <textarea value={sub.description} onChange={e => updateSubstep(step.id, sub.id, { description: e.target.value })}
                                      rows={1} placeholder="子步骤描述..."
                                      className="w-full bg-[#252536] border border-[#383850] rounded px-2 py-1 text-xs text-[#9898b0] resize-none focus:outline-none focus:border-[#3b82f6]" />
                                    <ArrayField label="关联文件" values={sub.files ?? []}
                                      onChange={v => updateSubstep(step.id, sub.id, { files: v })} placeholder="*.cif" compact />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-[#4a4a60]">无子步骤</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => addStep(stage.id)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-[#6b6b80] hover:text-white hover:bg-[#2d2d44] rounded-lg border border-dashed border-[#383850] transition-colors">
                  <Plus size={13} /> 添加步骤
                </button>
              </div>
            </div>
          );
        })}

        {/* Add stage button */}
        <button onClick={addStage}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-sm text-[#6b6b80] hover:text-white hover:bg-[#1a1a2e] rounded-xl border border-dashed border-[#383850] transition-colors">
          <Plus size={15} /> 添加阶段
        </button>
      </div>

      {/* Confirmation modal */}
      {confirm && (
        <ConfirmModal title={confirm.title} message={confirm.message}
          onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      )}
    </div>
  );
}

// === Helper components ===

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function ArrayField({ label, values, onChange, placeholder, compact }: {
  label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; compact?: boolean;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v) { onChange([...values, v]); setInput(''); }
  };
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {values.map((v, i) => (
          <span key={i} className="flex items-center gap-1 bg-[#1a1a2e] border border-[#383850] rounded px-2 py-1 text-xs text-[#e2e2f0] font-mono">
            {v}
            <button onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              className="text-[#6b6b80] hover:text-[#ef4444] ml-0.5"><X size={10} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className={`flex-1 bg-[#1a1a2e] border border-[#383850] rounded-lg px-3 py-${compact ? '1' : '2'} text-xs text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]`} />
        <button onClick={add}
          className="px-2.5 bg-[#2d2d44] text-[#9898b0] hover:text-white hover:bg-[#383850] rounded-lg text-xs">
          <Plus size={12} />
        </button>
      </div>
    </Field>
  );
}

function ConfirmModal({ title, message, onConfirm, onCancel }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onCancel}>
      <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#2d2d44]">
          <AlertTriangle size={16} className="text-[#f59e0b]" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-[#9898b0] leading-relaxed whitespace-pre-line">{message}</p>
        </div>
        <div className="px-5 py-4 border-t border-[#2d2d44] flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-[#ef4444] text-white text-xs rounded-lg hover:bg-[#dc2626]">确认</button>
        </div>
      </div>
    </div>
  );
}

// === Utils ===

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
