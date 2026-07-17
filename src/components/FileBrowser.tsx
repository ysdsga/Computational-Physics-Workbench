import { useState, useCallback, useEffect } from 'react';
import { ChevronRight, Folder, FileText, ArrowLeft, Plus, Eye, X } from 'lucide-react';
import { filesApi } from '../api/client';
import type { FileEntry } from '../types';

interface Props {
  projectId: string;
  workingDir: string;
}

export default function FileBrowser({ projectId, workingDir }: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [showMkdir, setShowMkdir] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workingDir) { setExists(false); return; }
    setLoading(true);
    try {
      const res = await filesApi.browse(projectId, currentPath);
      setEntries(res.entries);
      setExists(res.exists);
    } catch {
      setExists(false);
    }
    setLoading(false);
  }, [projectId, currentPath, workingDir]);

  useEffect(() => { load(); }, [load]);

  const handleEnterDir = (name: string) => {
    setCurrentPath(prev => prev ? `${prev}/${name}` : name);
  };

  const handleGoUp = () => {
    setCurrentPath(prev => {
      const parts = prev.split('/');
      parts.pop();
      return parts.join('/');
    });
  };

  const handleViewFile = async (entry: FileEntry) => {
    try {
      const res = await filesApi.read(projectId, entry.relativePath);
      setViewingFile({ name: res.name, content: res.content });
    } catch (e) {
      setViewingFile({ name: entry.name, content: `[无法读取文件: ${(e as Error).message}]` });
    }
  };

  const handleMkdir = async () => {
    if (!mkdirName.trim()) return;
    setError('');
    try {
      await filesApi.mkdir(projectId, currentPath, mkdirName.trim());
      setMkdirName(''); setShowMkdir(false); load();
    } catch (e) {
      setError(`创建文件夹失败: ${(e as Error).message}`);
    }
  };

  const pathParts = currentPath ? currentPath.split('/') : [];

  if (!workingDir) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Folder size={40} className="mx-auto text-[#383850] mb-3" />
          <p className="text-sm text-[#6b6b80] mb-2">未设置工作目录</p>
          <p className="text-xs text-[#4a4a60]">请在项目设置中配置工作目录路径</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-5 py-3 border-b border-[#2d2d44]">
        {currentPath && (
          <button onClick={handleGoUp} className="p-1 text-[#6b6b80] hover:text-white rounded hover:bg-[#2d2d44]">
            <ArrowLeft size={14} />
          </button>
        )}
        <button onClick={() => setCurrentPath('')} className="text-xs text-[#9898b0] hover:text-white">根目录</button>
        {pathParts.map((part, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-[#4a4a60]" />
            <button onClick={() => setCurrentPath(pathParts.slice(0, i + 1).join('/'))}
              className="text-xs text-[#9898b0] hover:text-white">{part}</button>
          </div>
        ))}
        <div className="flex-1" />
        <button onClick={() => setShowMkdir(!showMkdir)}
          className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
          <Plus size={11} /> 新建文件夹
        </button>
      </div>

      {/* Mkdir form */}
      {showMkdir && (
        <div className="px-5 py-2 border-b border-[#2d2d44] flex gap-2">
          <input value={mkdirName} onChange={e => setMkdirName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleMkdir()}
            className="flex-1 bg-[#252536] border border-[#383850] rounded px-2 py-1.5 text-xs text-[#e2e2f0] focus:outline-none focus:border-[#3b82f6]"
            placeholder="文件夹名称" autoFocus />
          <button onClick={handleMkdir} className="px-3 py-1.5 bg-[#3b82f6] text-white text-xs rounded hover:bg-[#2563eb]">创建</button>
          <button onClick={() => { setShowMkdir(false); setMkdirName(''); setError(''); }} className="px-2 py-1.5 text-[#6b6b80] text-xs rounded hover:text-white hover:bg-[#2d2d44]">取消</button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-5 py-2 bg-red-500/10 border-b border-[#2d2d44] text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400/60 hover:text-red-400 ml-2">✕</button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="text-center py-8 text-sm text-[#6b6b80]">加载中...</div>
        ) : !exists ? (
          <div className="text-center py-8">
            <Folder size={36} className="mx-auto text-[#383850] mb-2" />
            <p className="text-sm text-[#6b6b80]">目录不存在</p>
            <p className="text-xs text-[#4a4a60] mt-1 font-mono">{workingDir}/{currentPath}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-sm text-[#6b6b80]">空目录</div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry, i) => (
              <div key={i}
                onClick={() => entry.isDirectory ? handleEnterDir(entry.name) : handleViewFile(entry)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#252536] cursor-pointer group">
                {entry.isDirectory
                  ? <Folder size={16} className="text-[#f59e0b] flex-shrink-0" />
                  : <FileText size={16} className="text-[#3b82f6] flex-shrink-0" />}
                <span className="text-sm text-[#e2e2f0] flex-1 truncate">{entry.name}</span>
                {!entry.isDirectory && (
                  <button onClick={e => { e.stopPropagation(); handleViewFile(entry); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[#6b6b80] hover:text-white rounded">
                    <Eye size={13} />
                  </button>
                )}
                <span className="text-[10px] text-[#4a4a60] flex-shrink-0">
                  {entry.isDirectory ? '—' : entry.size < 1024 ? `${entry.size} B` : entry.size < 1024 * 1024 ? `${(entry.size / 1024).toFixed(1)} KB` : `${(entry.size / 1024 / 1024).toFixed(1)} MB`}
                </span>
              </div>
            ))}
          </div>
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
