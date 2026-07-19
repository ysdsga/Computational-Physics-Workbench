import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Trash2, Edit3, Tag, BookOpen, Bookmark } from 'lucide-react';
import { experiencesApi } from '../api/client';
import { useWorkflowList } from '../contexts/WorkflowContext';
import type { Experience } from '../types';

export default function ExperiencePage() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingExp, setEditingExp] = useState<Experience | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formStepId, setFormStepId] = useState('');
  const workflows = useWorkflowList();

  const load = useCallback(async () => {
    try { setExperiences(await experiencesApi.list()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = experiences.filter(e => {
    if (!search) return true;
    const tags = JSON.parse(e.tags || '[]') as string[];
    return e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.content.toLowerCase().includes(search.toLowerCase()) ||
      tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
  });

  const resetForm = () => {
    setFormTitle(''); setFormContent(''); setFormTags('');
    setFormStepId('');
    setEditingExp(null); setShowForm(false);
  };

  const openEdit = (exp: Experience) => {
    setFormTitle(exp.title); setFormContent(exp.content);
    setFormTags((JSON.parse(exp.tags || '[]') as string[]).join(', '));
    setFormStepId(exp.related_step_id ?? '');
    setEditingExp(exp); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    const tags = formTags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    if (editingExp) {
      await experiencesApi.update(editingExp.id, {
        title: formTitle.trim(), content: formContent.trim(), tags,
        related_step_id: formStepId || undefined,
      });
    } else {
      await experiencesApi.create({
        title: formTitle.trim(), content: formContent.trim(), tags,
        related_step_id: formStepId || undefined,
      });
    }
    resetForm(); load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此经验？')) return;
    await experiencesApi.delete(id); load();
  };

  const allSteps = workflows.flatMap(w => w.steps.map(s => ({ workflow: w, step: s })));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2d44]">
        <div>
          <h2 className="text-base font-semibold text-white">经验库</h2>
          <p className="text-xs text-[#6b6b80] mt-0.5">沉淀每次 DFT+DMFT 计算的经验和教训</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#8b5cf6] text-white text-xs rounded-lg hover:bg-[#7c3aed]">
          <Plus size={14} /> 添加经验
        </button>
      </div>

      <div className="px-5 py-3 border-b border-[#2d2d44]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b80]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索经验（标题、内容、标签）..."
            className="w-full bg-[#252536] border border-[#383850] rounded-lg pl-9 pr-4 py-2 text-sm text-[#e2e2f0] placeholder-[#4a4a60] focus:outline-none focus:border-[#8b5cf6]" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen size={40} className="mx-auto text-[#383850] mb-3" />
            <p className="text-sm text-[#6b6b80]">{search ? '没有匹配的经验' : '经验库为空，点击"添加经验"开始记录'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filtered.map(exp => {
              const tags = JSON.parse(exp.tags || '[]') as string[];
              const step = exp.related_step_id ? allSteps.find(s => s.step.id === exp.related_step_id) : undefined;

              return (
                <div key={exp.id} className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4 hover:border-[#383850] transition-colors group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Bookmark size={14} className="text-[#8b5cf6] flex-shrink-0 mt-0.5" />
                      <h3 className="text-sm font-semibold text-white truncate">{exp.title}</h3>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(exp)} className="p-1 text-[#6b6b80] hover:text-white rounded hover:bg-[#2d2d44]"><Edit3 size={13} /></button>
                      <button onClick={() => handleDelete(exp.id)} className="p-1 text-[#6b6b80] hover:text-red-400 rounded hover:bg-[#2d2d44]"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <p className="text-xs text-[#9898b0] mb-3 line-clamp-3 whitespace-pre-wrap leading-relaxed">{exp.content}</p>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {tags.map((tag, i) => (
                        <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#2d2d44] text-[#9898b0]"><Tag size={9} />{tag}</span>
                      ))}
                    </div>
                  )}
                  {step && (
                    <div className="mb-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8b5cf6]/5 text-[#8b5cf6]/60 border border-[#8b5cf6]/10">
                        {step.workflow.name} · {step.step.name}
                      </span>
                    </div>
                  )}
                  {exp.source_task_spec_id && (
                    <div className="mb-2 text-[10px] font-mono text-[#6b6b80]">来源 Task Spec：{exp.source_task_spec_id}</div>
                  )}
                  <div className="text-[10px] text-[#4a4a60]">{new Date(exp.updated_at).toLocaleString('zh-CN')}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl w-[560px] max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2d2d44]">
              <h3 className="text-sm font-semibold text-white">{editingExp ? '编辑经验' : '添加经验'}</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">标题 *</label>
                <input value={formTitle} onChange={e => setFormTitle(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#8b5cf6]"
                  placeholder="例如：V2O3 Wannier 投影收敛经验" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">内容 *</label>
                <textarea value={formContent} onChange={e => setFormContent(e.target.value)} rows={6}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] resize-none focus:outline-none focus:border-[#8b5cf6]"
                  placeholder="记录这次计算的经验、遇到的问题、解决方案..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">标签（逗号分隔）</label>
                <input value={formTags} onChange={e => setFormTags(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#8b5cf6]"
                  placeholder="V2O3, Wannier90, 收敛问题" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">关联步骤（可选）</label>
                <select value={formStepId} onChange={e => setFormStepId(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#8b5cf6]">
                  <option value="">不关联</option>
                  {workflows.map(w => (
                    <optgroup key={w.id} label={w.name}>
                      {w.stages.map(st => (
                        <optgroup key={st.id} label={`  ${st.name}`}>
                          {w.steps.filter(s => s.stageId === st.id).map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#2d2d44] flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 bg-[#8b5cf6] text-white text-xs rounded-lg hover:bg-[#7c3aed]">{editingExp ? '保存修改' : '添加经验'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
