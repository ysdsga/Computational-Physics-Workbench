import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus, Search, Trash2, Tag, FileText, X,
  CheckCircle2, Upload, Edit3, Eye, Save, AlertTriangle,
} from 'lucide-react';
import { researchPlansApi, projectsApi, tasksApi, contractsApi } from '../api/client';
import type { ResearchPlan, ResearchPlanStatus, Project, Task } from '../types';

const STATUS_META: Record<ResearchPlanStatus, { label: string; color: string; bg: string; border: string }> = {
  draft:     { label: '草稿',   color: '#6b6b80', bg: 'rgba(107,107,128,0.10)', border: 'rgba(107,107,128,0.30)' },
  active:    { label: '进行中', color: '#22c55e', bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.30)' },
  completed: { label: '已完成', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)',  border: 'rgba(59,130,246,0.30)' },
  archived:  { label: '已归档', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.30)' },
};
const STATUS_ORDER: ResearchPlanStatus[] = ['draft', 'active', 'completed', 'archived'];

function parseJsonArray<T = string>(s: string | undefined | null, fallback: T[] = []): T[] {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

type Mode = 'view' | 'edit';

export default function ResearchPlansPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [plans, setPlans] = useState<ResearchPlan[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResearchPlanStatus | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));

  // content state
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [mode, setMode] = useState<Mode>('view');
  const [dirty, setDirty] = useState(false);
  const [contractStatus, setContractStatus] = useState<'missing' | 'valid' | 'drift'>('missing');

  // Scroll position preservation when switching view/edit
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);

  const switchMode = useCallback((next: Mode) => {
    if (next === mode) return;
    // save current scroll before unmounting the current body
    if (scrollRef.current) savedScroll.current = scrollRef.current.scrollTop;
    setMode(next);
    // restore after the new body renders
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
    });
  }, [mode]);

  // metadata form
  const [editingMeta, setEditingMeta] = useState(false);
  const [fTitle, setFTitle] = useState('');
  const [fStatus, setFStatus] = useState<ResearchPlanStatus>('draft');
  const [fProjectId, setFProjectId] = useState('');
  const [fTags, setFTags] = useState('');
  const [fLinkedTaskIds, setFLinkedTaskIds] = useState<string[]>([]);

  // import dialog
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<'path' | 'paste'>('path');
  const [importPath, setImportPath] = useState('');
  const [importName, setImportName] = useState('');
  const [importContent, setImportContent] = useState('');
  const [importProjectId, setImportProjectId] = useState('');

  const load = useCallback(async () => {
    try {
      const [ps, projs] = await Promise.all([
        researchPlansApi.list(),
        projectsApi.list(),
      ]);
      setPlans(ps);
      setProjects(projs);
      const pids = new Set<string>();
      ps.forEach(p => { if (p.project_id) pids.add(p.project_id); });
      const tpp = await Promise.all(
        Array.from(pids).map(pid => tasksApi.list(pid).catch(() => [] as Task[])),
      );
      const flat: Task[] = [];
      tpp.forEach(arr => flat.push(...arr));
      setAllTasks(flat);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load content + metadata when selection changes
  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setContent(''); setOriginalContent(''); setDirty(false);
      return;
    }
    const plan = plans.find(p => p.id === selectedId);
    if (!plan) return;
    setFTitle(plan.title);
    setFStatus(plan.status);
    setFProjectId(plan.project_id ?? '');
    setFTags(parseJsonArray(plan.tags).join(', '));
    setFLinkedTaskIds(parseJsonArray(plan.linked_task_ids));
    setMode('view'); setEditingMeta(false); setDirty(false);
    setLoadingContent(true);
    try {
      const { content: c } = await researchPlansApi.getContent(selectedId);
      setContent(c); setOriginalContent(c);
      try {
        const contract = await contractsApi.get(selectedId);
        setContractStatus(contract.drift ? 'drift' : 'valid');
      } catch {
        setContractStatus('missing');
      }
    } catch (e) {
      setContent(`# 无法读取\n\n错误：${(e as Error).message}`);
    } finally {
      setLoadingContent(false);
    }
  }, [selectedId, plans]);

  useEffect(() => { loadSelected(); }, [loadSelected]);

  // sync URL ?id=
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedId) next.set('id', selectedId);
    else next.delete('id');
    setSearchParams(next, { replace: true });
  }, [selectedId]);

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p] as const)), [projects]);
  const writableProjects = useMemo(
    () => projects.filter(project => project.working_dir.trim()),
    [projects],
  );
  const editingProjectTasks = useMemo(
    () => allTasks.filter(t => t.project_id === (fProjectId || '')),
    [allTasks, fProjectId],
  );

  const filtered = useMemo(() => {
    return plans.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (projectFilter !== 'all' && p.project_id !== projectFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const tags = parseJsonArray(p.tags).join(' ').toLowerCase();
        if (!p.title.toLowerCase().includes(s) && !tags.includes(s)) return false;
      }
      return true;
    });
  }, [plans, statusFilter, projectFilter, search]);

  const selected = plans.find(p => p.id === selectedId) || null;

  // ===== Handlers =====

  const handleCreate = async () => {
    if (projectFilter === 'all') {
      alert('请先在项目筛选中选择研究方案所属项目');
      return;
    }
    const project = projectMap.get(projectFilter);
    if (!project?.working_dir.trim()) {
      alert('所选项目尚未配置工作目录');
      return;
    }
    const title = prompt('方案标题：');
    if (!title?.trim()) return;
    try {
      const p = await researchPlansApi.create({ title: title.trim(), project_id: project.id });
      setPlans(prev => [p, ...prev]);
      setSelectedId(p.id);
    } catch (e) {
      alert(`创建失败：${(e as Error).message}`);
    }
  };

  const handleImport = async () => {
    if (!importProjectId) return alert('请选择研究方案所属项目');
    try {
      let p: ResearchPlan;
      if (importMode === 'path') {
        if (!importPath.trim()) return alert('请填路径');
        p = await researchPlansApi.import({
          sourcePath: importPath.trim(),
          fileName: importName.trim() || undefined,
          project_id: importProjectId,
        });
      } else {
        if (!importContent.trim()) return alert('请粘贴内容');
        p = await researchPlansApi.import({
          content: importContent,
          fileName: importName.trim() || `imported_${Date.now()}.md`,
          project_id: importProjectId,
        });
      }
      setPlans(prev => [p, ...prev]);
      setSelectedId(p.id);
      setShowImport(false);
      setImportPath(''); setImportName(''); setImportContent(''); setImportProjectId('');
    } catch (e) {
      alert(`导入失败：${(e as Error).message}`);
    }
  };

  const handleSaveContent = async () => {
    if (!selectedId || !dirty) return;
    try {
      await researchPlansApi.saveContent(selectedId, content);
      setOriginalContent(content);
      setDirty(false);
      if (contractStatus === 'valid') setContractStatus('drift');
      setPlans(prev => prev.map(p => p.id === selectedId ? { ...p, updated_at: new Date().toISOString() } : p));
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    }
  };

  const handleSaveMeta = async () => {
    if (!selected) return;
    const tags = fTags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    try {
      const updated = await researchPlansApi.update(selected.id, {
        title: fTitle.trim() || selected.title,
        status: fStatus,
        tags,
        linked_task_ids: fLinkedTaskIds,
      });
      setPlans(prev => prev.map(p => p.id === updated.id ? updated : p));
      setEditingMeta(false);
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此研究方案？文件会一并删除。')) return;
    try {
      await researchPlansApi.delete(id);
      if (selectedId === id) setSelectedId(null);
      setPlans(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      const item = e as Error & { code?: string };
      if (item.code === 'RUN_HISTORY_PROTECTED' && confirm('该研究方案已有运行记录，不能物理删除。是否改为归档？')) {
        const updated = await researchPlansApi.update(id, { status: 'archived' });
        setPlans(prev => prev.map(plan => plan.id === id ? updated : plan));
      } else alert(`删除失败：${item.message}`);
    }
  };

  const onContentChange = (v: string) => {
    setContent(v);
    setDirty(v !== originalContent);
  };

  const toggleLinkedTask = (id: string) => {
    setFLinkedTaskIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const projName = (pid: string | null) => pid ? (projectMap.get(pid)?.name ?? '?') : null;

  // ===== Render =====
  return (
    <div className="flex h-full">
      {/* === Left: list === */}
      <div className="w-[360px] flex-shrink-0 border-r border-[#2d2d44] flex flex-col">
        <div className="px-5 py-4 border-b border-[#2d2d44]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-white">研究方案</h2>
              <p className="text-xs text-[#6b6b80] mt-0.5">Markdown 文件 · 保存在所属项目工作目录</p>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => {
                setImportProjectId(projectFilter === 'all' ? '' : projectFilter);
                setShowImport(true);
              }}
                className="flex items-center gap-1 px-2.5 py-2 bg-[#252536] border border-[#383850] text-[#e2e2f0] text-xs rounded-lg hover:bg-[#2d2d44]">
                <Upload size={13} /> 导入
              </button>
              <button onClick={handleCreate}
                className="flex items-center gap-1 px-2.5 py-2 bg-[#8b5cf6] text-white text-xs rounded-lg hover:bg-[#7c3aed]">
                <Plus size={13} /> 新建
              </button>
            </div>
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b80]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标题或标签..."
              className="w-full bg-[#252536] border border-[#383850] rounded-lg pl-9 pr-3 py-2 text-xs text-[#e2e2f0] placeholder-[#4a4a60] focus:outline-none focus:border-[#8b5cf6]" />
          </div>
          <div className="flex gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as ResearchPlanStatus | 'all')}
              className="flex-1 bg-[#252536] border border-[#383850] rounded-lg px-2 py-1.5 text-[11px] text-[#e2e2f0] focus:outline-none focus:border-[#8b5cf6]">
              <option value="all">全部状态</option>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
              className="flex-1 bg-[#252536] border border-[#383850] rounded-lg px-2 py-1.5 text-[11px] text-[#e2e2f0] focus:outline-none focus:border-[#8b5cf6]">
              <option value="all">全部项目</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-12 px-5">
              <FileText size={36} className="mx-auto text-[#383850] mb-3" />
              <p className="text-xs text-[#6b6b80]">
                {plans.length === 0 ? '研究方案为空，点击"新建"或"导入"开始' : '没有匹配的方案'}
              </p>
            </div>
          ) : (
            <div className="py-2">
              {filtered.map(plan => {
                const meta = STATUS_META[plan.status];
                const proj = projName(plan.project_id);
                const tags = parseJsonArray(plan.tags);
                const isSelected = selectedId === plan.id;
                return (
                  <button key={plan.id} onClick={() => setSelectedId(plan.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors border mx-2 ${
                      isSelected ? 'bg-[#2d2d44] border-[#8b5cf6]/40' : 'border-transparent hover:bg-[#252536]'
                    }`}
                    style={{ width: 'calc(100% - 16px)' }}>
                    <div className="flex items-start gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] flex-shrink-0"
                        style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
                        {meta.label}
                      </span>
                      <h3 className="text-sm font-medium text-white flex-1 leading-snug line-clamp-2">{plan.title}</h3>
                    </div>
                    <div className="text-[10px] text-[#6b6b80] font-mono truncate mb-1">{plan.file_name}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {proj && (
                        <span className="text-[9px] text-[#3b82f6]/80 bg-[#3b82f6]/5 px-1.5 py-0.5 rounded border border-[#3b82f6]/10">{proj}</span>
                      )}
                      {plan.missing && (
                        <span className="text-[9px] text-[#ef4444] flex items-center gap-0.5">
                          <AlertTriangle size={9} /> 文件丢失
                        </span>
                      )}
                      {tags.length > 0 && tags.slice(0, 2).map((t: string) => (
                        <span key={t} className="text-[9px] text-[#9898b0] flex items-center gap-0.5">
                          <Tag size={9} /> {t}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* === Right: detail / viewer === */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={48} className="mx-auto text-[#383850] mb-3" />
              <h3 className="text-sm font-medium text-[#9898b0] mb-1">未选择研究方案</h3>
              <p className="text-xs text-[#6b6b80]">从左侧列表选择，或点击"新建/导入"</p>
            </div>
          </div>
        ) : (
          <>
            {/* Top: title + metadata summary */}
            <div className="px-6 py-4 border-b border-[#2d2d44] flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {editingMeta ? (
                  <input value={fTitle} onChange={e => setFTitle(e.target.value)}
                    className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-1.5 text-base font-semibold text-white mb-2" />
                ) : (
                  <h2 className="text-base font-semibold text-white mb-1">{selected.title}</h2>
                )}
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  {editingMeta ? (
                    <>
                      <select value={fStatus} onChange={e => setFStatus(e.target.value as ResearchPlanStatus)}
                        className="bg-[#252536] border border-[#383850] rounded px-2 py-1 text-[#e2e2f0]">
                        {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                      </select>
                      <select value={fProjectId} onChange={e => setFProjectId(e.target.value)}
                        disabled
                        title="研究方案文件固定保存在创建时选择的项目工作目录中"
                        className="bg-[#252536] border border-[#383850] rounded px-2 py-1 text-[#9898b0] disabled:cursor-not-allowed">
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input value={fTags} onChange={e => setFTags(e.target.value)} placeholder="标签（逗号分隔）"
                        className="flex-1 min-w-[150px] bg-[#252536] border border-[#383850] rounded px-2 py-1 text-[#e2e2f0]" />
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-[#6b6b80]">{selected.file_name}</span>
                      {projName(selected.project_id) && (
                        <span className="text-[#3b82f6]/80 bg-[#3b82f6]/5 px-1.5 py-0.5 rounded border border-[#3b82f6]/10">
                          {projName(selected.project_id)}
                        </span>
                      )}
                      <span className="text-[#6b6b80]">更新于 {new Date(selected.updated_at).toLocaleString()}</span>
                      <span className={`px-1.5 py-0.5 rounded border ${contractStatus === 'valid' ? 'text-[#22c55e] border-[#22c55e]/30 bg-[#22c55e]/5' : contractStatus === 'drift' ? 'text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/5' : 'text-[#9898b0] border-[#383850]'}`}>
                        {contractStatus === 'valid' ? '合同已绑定' : contractStatus === 'drift' ? '合同 drift' : '未创建合同'}
                      </span>
                    </>
                  )}
                </div>
                {editingMeta && editingProjectTasks.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[10px] text-[#6b6b80]">关联任务：</span>
                    {editingProjectTasks.map(t => (
                      <button key={t.id} onClick={() => toggleLinkedTask(t.id)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          fLinkedTaskIds.includes(t.id)
                            ? 'bg-[#8b5cf6]/20 text-[#a78bfa] border-[#8b5cf6]/40'
                            : 'bg-[#252536] text-[#6b6b80] border-[#383850]'
                        }`}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {editingMeta ? (
                  <>
                    <button onClick={() => { setEditingMeta(false); loadSelected(); }}
                      className="px-3 py-1.5 text-xs bg-[#252536] border border-[#383850] text-[#e2e2f0] rounded-lg hover:bg-[#2d2d44]">
                      取消
                    </button>
                    <button onClick={handleSaveMeta}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#22c55e] text-white rounded-lg hover:bg-[#16a34a]">
                      <CheckCircle2 size={13} /> 保存元数据
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditingMeta(true)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#252536] border border-[#383850] text-[#e2e2f0] rounded-lg hover:bg-[#2d2d44]">
                      <Edit3 size={13} /> 编辑信息
                    </button>
                    <button onClick={() => handleDelete(selected.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#252536] border border-[#ef4444]/30 text-[#ef4444] rounded-lg hover:bg-[#ef4444]/10">
                      <Trash2 size={13} /> 删除
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="border-b border-[#2d2d44] bg-[#171725] px-6 py-3 text-[10px] leading-5 text-[#9898b0]">
              <strong className="text-[#c4b5fd]">版本规则：</strong>这里编辑的是可持续修订的工作副本，普通保存直接更新 Markdown，不为每个小改动生成完整版本。只有研究者与 Codex 明确把方案用于某个 Research Run 时，才把方案、合同、工作流和策略作为不可变 context 快照采用；之后继续编辑会显示 drift，需要重新沟通后采用。
            </div>

            {/* Toolbar: preview/edit + save content */}
            <div className="px-6 py-2 border-b border-[#2d2d44] flex items-center justify-between">
              <div className="flex gap-1">
                <button onClick={() => switchMode('view')}
                  className={`flex items-center gap-1 px-3 py-1 text-xs rounded ${mode === 'view' ? 'bg-[#8b5cf6]/20 text-[#a78bfa]' : 'text-[#6b6b80] hover:text-white'}`}>
                  <Eye size={12} /> 预览
                </button>
                <button onClick={() => switchMode('edit')}
                  className={`flex items-center gap-1 px-3 py-1 text-xs rounded ${mode === 'edit' ? 'bg-[#8b5cf6]/20 text-[#a78bfa]' : 'text-[#6b6b80] hover:text-white'}`}>
                  <Edit3 size={12} /> 编辑
                </button>
              </div>
              {dirty && (
                <button onClick={handleSaveContent}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-[#22c55e] text-white rounded-lg hover:bg-[#16a34a]">
                  <Save size={12} /> 保存正文
                </button>
              )}
            </div>

            {/* Body */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {loadingContent ? (
                <div className="flex items-center justify-center h-full text-sm text-[#6b6b80]">加载中...</div>
              ) : mode === 'view' ? (
                <div className="research-plan-markdown max-w-4xl mx-auto px-8 py-6">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={e => onContentChange(e.target.value)}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                      e.preventDefault();
                      handleSaveContent();
                    }
                  }}
                  className="w-full bg-[#1a1a28] text-[#e2e2f0] font-mono text-sm p-6 resize-none focus:outline-none border-0"
                  placeholder="在此编辑 Markdown..."
                  style={{ minHeight: '100%', height: Math.max(content.split('\n').length * 21 + 48, 600) }}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* === Import dialog === */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowImport(false)}>
          <div className="bg-[#252536] border border-[#383850] rounded-xl p-6 w-[520px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">导入研究方案</h3>
              <button onClick={() => setShowImport(false)} className="text-[#6b6b80] hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="flex gap-2 mb-4">
              <button onClick={() => setImportMode('path')}
                className={`flex-1 px-3 py-2 text-xs rounded-lg ${importMode === 'path' ? 'bg-[#8b5cf6] text-white' : 'bg-[#1a1a28] text-[#9898b0]'}`}>
                从本机路径复制
              </button>
              <button onClick={() => setImportMode('paste')}
                className={`flex-1 px-3 py-2 text-xs rounded-lg ${importMode === 'paste' ? 'bg-[#8b5cf6] text-white' : 'bg-[#1a1a28] text-[#9898b0]'}`}>
                粘贴 Markdown 内容
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#9898b0] mb-1 block">所属项目</label>
                <select value={importProjectId} onChange={e => setImportProjectId(e.target.value)}
                  className="w-full bg-[#1a1a28] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0]">
                  <option value="">请选择已配置工作目录的项目</option>
                  {writableProjects.map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
              {importMode === 'path' ? (
                <div>
                  <label className="text-xs text-[#9898b0] mb-1 block">本机文件绝对路径</label>
                  <input value={importPath} onChange={e => setImportPath(e.target.value)}
                    placeholder="D:\path\to\plan.md"
                    className="w-full bg-[#1a1a28] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0] font-mono" />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-[#9898b0] mb-1 block">Markdown 内容</label>
                  <textarea value={importContent} onChange={e => setImportContent(e.target.value)}
                    placeholder="# 方案标题..."
                    className="w-full h-40 bg-[#1a1a28] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0] font-mono resize-none" />
                </div>
              )}
              <div>
                <label className="text-xs text-[#9898b0] mb-1 block">目标文件名（可选，默认用源文件名）</label>
                <input value={importName} onChange={e => setImportName(e.target.value)}
                  placeholder="my_plan.md"
                  className="w-full bg-[#1a1a28] border border-[#383850] rounded-lg px-3 py-2 text-xs text-[#e2e2f0] font-mono" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowImport(false)}
                  className="px-4 py-2 text-xs bg-[#1a1a28] border border-[#383850] text-[#e2e2f0] rounded-lg">取消</button>
                <button onClick={handleImport}
                  className="px-4 py-2 text-xs bg-[#8b5cf6] text-white rounded-lg hover:bg-[#7c3aed]">导入</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
