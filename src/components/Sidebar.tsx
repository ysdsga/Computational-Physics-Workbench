import { NavLink } from 'react-router-dom';
import { t, useLocale, type Locale } from '../i18n';
import { FolderKanban, BookOpen, GitBranch, Server, FileText, Bot, ClipboardCheck, FileCheck2 } from 'lucide-react';

const navigation = () => [
  { to: '/', icon: FolderKanban, label: t('项目仓库', 'Projects'), end: true },
  { to: '/workflow', icon: GitBranch, label: t('工作流', 'Workflows') },
  { to: '/research-plans', icon: FileText, label: t('研究方案', 'Research plans') },
  { to: '/agent-runs', icon: Bot, label: t('Agent 运行记录', 'Agent runs') },
  { to: '/reviews', icon: ClipboardCheck, label: t('待沟通事项', 'Pending discussions') },
  { to: '/supercomputers', icon: Server, label: t('超算管理', 'Remote compute') },
  { to: '/evidence', icon: FileCheck2, label: t('证据库', 'Evidence') },
  { to: '/experiences', icon: BookOpen, label: t('经验库', 'Experience') },
];

export default function Sidebar() {
  const [locale, setLocale] = useLocale();
  return (
    <aside className="w-56 bg-[#1a1a2e] border-r border-[#2d2d44] flex flex-col flex-shrink-0">
      <div className="px-5 py-5 border-b border-[#2d2d44]">
        <h1 className="text-base font-bold text-white tracking-wide">
          Computational Physics
        </h1>
        <p className="text-xs text-[#6b6b80] mt-0.5">Workbench</p>
      </div>
      <nav className="flex-1 py-3">
        {navigation().map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-2.5 mx-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-[#2d2d44] text-white font-medium'
                  : 'text-[#9898b0] hover:text-white hover:bg-[#252536]'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-[#2d2d44]">
        <label className="block text-xs text-[#9898b0] mb-3">
          Language / 语言
          <select aria-label="Language / 语言" value={locale} onChange={event => setLocale(event.target.value as Locale)}
            className="mt-1 w-full rounded border border-[#2d2d44] bg-[#131320] px-2 py-1.5 text-white">
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>
        <p className="text-[10px] text-[#4a4a60] leading-relaxed">
          Codex-driven workbench · V3
        </p>
      </div>
    </aside>
  );
}
