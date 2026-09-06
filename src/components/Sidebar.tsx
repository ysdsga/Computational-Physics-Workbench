import { NavLink } from 'react-router-dom';
import { FolderKanban, BookOpen, GitBranch, Server, FileText, Bot, ClipboardCheck, FileCheck2 } from 'lucide-react';

const navItems = [
  { to: '/', icon: FolderKanban, label: '项目仓库', end: true },
  { to: '/workflow', icon: GitBranch, label: '工作流' },
  { to: '/research-plans', icon: FileText, label: '研究方案' },
  { to: '/agent-runs', icon: Bot, label: 'Agent 运行记录' },
  { to: '/reviews', icon: ClipboardCheck, label: '待沟通事项' },
  { to: '/supercomputers', icon: Server, label: '超算管理' },
  { to: '/evidence', icon: FileCheck2, label: '证据库' },
  { to: '/experiences', icon: BookOpen, label: '经验库' },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-[#1a1a2e] border-r border-[#2d2d44] flex flex-col flex-shrink-0">
      <div className="px-5 py-5 border-b border-[#2d2d44]">
        <h1 className="text-base font-bold text-white tracking-wide">
          Computational Physics
        </h1>
        <p className="text-xs text-[#6b6b80] mt-0.5">Workbench</p>
      </div>
      <nav className="flex-1 py-3">
        {navItems.map(({ to, icon: Icon, label, end }) => (
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
        <p className="text-[10px] text-[#4a4a60] leading-relaxed">
          Codex-driven workbench · V3
        </p>
      </div>
    </aside>
  );
}
