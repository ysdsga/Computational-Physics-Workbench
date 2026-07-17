import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, Edit3, FolderOpen, FlaskConical } from 'lucide-react';
import { projectsApi } from '../api/client';
import type { Project } from '../types';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [formName, setFormName] = useState('');
  const [formMaterial, setFormMaterial] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDir, setFormDir] = useState('');

  const load = useCallback(async () => {
    try { setProjects(await projectsApi.list()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = projects.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.material || '').toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setFormName(''); setFormMaterial(''); setFormDesc(''); setFormDir('');
    setEditing(null); setShowForm(false);
  };

  const openEdit = (p: Project) => {
    setFormName(p.name); setFormMaterial(p.material); setFormDesc(p.description);
    setFormDir(p.working_dir); setEditing(p); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) return;
    if (editing) {
      await projectsApi.update(editing.id, { name: formName.trim(), material: formMaterial.trim(), description: formDesc.trim(), working_dir: formDir.trim() });
    } else {
      await projectsApi.create({ name: formName.trim(), material: formMaterial.trim(), description: formDesc.trim(), working_dir: formDir.trim() });
    }
    resetForm(); load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此项目？所有关联的任务和进度将一并删除。')) return;
    await projectsApi.delete(id); load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2d44]">
        <div>
          <h2 className="text-base font-semibold text-white">项目仓库</h2>
          <p className="text-xs text-[#6b6b80] mt-0.5">管理 DFT+DMFT 研究项目</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">
          <Plus size={14} /> 新建项目
        </button>
      </div>

      <div className="px-5 py-3 border-b border-[#2d2d44]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b80]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索项目..."
            className="w-full bg-[#252536] border border-[#383850] rounded-lg pl-9 pr-4 py-2 text-sm text-[#e2e2f0] placeholder-[#4a4a60] focus:outline-none focus:border-[#3b82f6]" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen size={40} className="mx-auto text-[#383850] mb-3" />
            <p className="text-sm text-[#6b6b80]">{search ? '没有匹配的项目' : '暂无项目，点击"新建项目"开始'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(p => (
              <div key={p.id} onClick={() => navigate(`/project/${p.id}`)}
                className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4 hover:border-[#383850] transition-colors cursor-pointer group">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FlaskConical size={16} className="text-[#3b82f6] flex-shrink-0" />
                    <h3 className="text-sm font-semibold text-white truncate">{p.name}</h3>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(p)} className="p-1 text-[#6b6b80] hover:text-white rounded hover:bg-[#2d2d44]"><Edit3 size={13} /></button>
                    <button onClick={() => handleDelete(p.id)} className="p-1 text-[#6b6b80] hover:text-red-400 rounded hover:bg-[#2d2d44]"><Trash2 size={13} /></button>
                  </div>
                </div>
                {p.material && (
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3b82f6]/10 text-[#3b82f6]/80 border border-[#3b82f6]/20">{p.material}</span>
                  </div>
                )}
                <p className="text-xs text-[#9898b0] mb-3 line-clamp-2">{p.description || '无描述'}</p>
                <div className="flex items-center justify-between text-[10px] text-[#4a4a60]">
                  <span>{p.task_count ?? 0} 个任务</span>
                  <span>{new Date(p.updated_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl w-[480px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2d2d44]">
              <h3 className="text-sm font-semibold text-white">{editing ? '编辑项目' : '新建项目'}</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">项目名称 *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
                  placeholder="例如：V2O3 电子结构研究" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">材料/体系</label>
                <input value={formMaterial} onChange={e => setFormMaterial(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
                  placeholder="例如：V2O3" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">描述</label>
                <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] resize-none focus:outline-none focus:border-[#3b82f6]"
                  placeholder="项目简要描述..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#6b6b80] mb-1 block">工作目录 (文件仓库路径)</label>
                <input value={formDir} onChange={e => setFormDir(e.target.value)}
                  className="w-full bg-[#252536] border border-[#383850] rounded-lg px-3 py-2 text-sm text-[#e2e2f0] font-mono focus:outline-none focus:border-[#3b82f6]"
                  placeholder="例如：D:/projects/v2o3" />
                <p className="text-[10px] text-[#4a4a60] mt-1">项目文件将在此目录下管理</p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#2d2d44] flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 text-xs text-[#6b6b80] hover:text-white rounded-lg hover:bg-[#2d2d44]">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 bg-[#3b82f6] text-white text-xs rounded-lg hover:bg-[#2563eb]">{editing ? '保存修改' : '创建项目'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
