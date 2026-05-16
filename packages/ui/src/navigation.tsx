import { useState, useEffect } from 'react';

export type NavPage = 'office' | 'factory' | 'employees' | 'memory' | 'meetings' | 'settings';

export interface NavigationProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  isDark?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigateToSession?: (sessionId: string) => void;
}

interface ProjectEntry {
  id: string;
  name: string;
  sessions: { id: string; title: string }[];
}

const navItems: { id: NavPage; label: string; icon: string }[] = [
  {
    id: 'office',
    label: 'Office',
    icon: 'M2 3h10a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z',
  },
  {
    id: 'meetings',
    label: 'Meetings',
    icon: 'M1 1h12v12H1V1zm2 2v8h8V3H3zm2 2h4v1H5V5zm0 2h4v1H5V7z',
  },
  {
    id: 'factory',
    label: 'Factory',
    icon: 'M6.5 2L9 5h2.5L9.5 8.5h2L8 13l-1.2-2.5H4l1-2.5h2.5L6.5 2z',
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: 'M5 4a2 2 0 012 2 2 2 0 01-2 2 2 2 0 01-2-2 2 2 0 012-2zm-3 7c0-1.5 1.5-2.5 3-2.5 1.5 0 3 1 3 2.5v.5H2v-.5zm6-3.5a1.5 1.5 0 011.5-1.5 1.5 1.5 0 011.5 1.5 1.5 1.5 0 01-1.5 1.5A1.5 1.5 0 018 7.5zm-1.5 3c0-.8.5-1.5 1-2 .4-.4 1-.6 1.7-.6h.4c1.2 0 2.3.7 2.7 1.7.2.4.2.7.2 1V11h-6v-.5z',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'M2 5h2v2H2V5zm3 0h2v2H5V5zm0 3h2v2H5V8zm3-3h2v2H8V5zm0 3h2v2H8V8zm3-3h2v2h-2V5zM2 8h2v2H2V8zm6 3h2v2H8v-2zm-3 0h2v2H5v-2zm-3 0h2v2H2v-2z',
  },
];

function useProjects() {
  const [projects, setProjects] = useState<ProjectEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cabinet-projects-sidebar') ?? '[]');
    } catch { return []; }
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem('cabinet-projects-sidebar', JSON.stringify(projects));
  }, [projects]);

  const addProject = () => {
    const name = prompt('Project name:');
    if (!name?.trim()) return;
    const id = `proj_${Date.now()}`;
    setProjects(prev => [...prev, { id, name: name.trim(), sessions: [] }]);
  };

  const deleteProject = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setExpanded(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return { projects, expanded, addProject, deleteProject, toggleExpand };
}

export function Navigation({
  activePage, onNavigate, isDark, collapsed, onToggleCollapse, onNavigateToSession,
}: NavigationProps) {
  const { projects, expanded, addProject, deleteProject, toggleExpand } = useProjects();
  const sidebarW = collapsed ? 'w-12' : 'w-40';
  const bg = isDark ? 'bg-gray-900' : 'bg-white';
  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const text = isDark ? 'text-gray-400' : 'text-gray-500';
  const activeBg = isDark ? 'bg-gray-800 text-white' : 'bg-blue-50 text-blue-700';
  const hover = isDark ? 'hover:bg-gray-800 hover:text-gray-200' : 'hover:bg-gray-100 hover:text-gray-700';

  return (
    <nav className={`h-full flex flex-col flex-shrink-0 border-r transition-all duration-200 ${sidebarW} ${bg} ${border}`}>
      {/* Logo */}
      <div className={`flex justify-center py-3 ${collapsed ? 'px-1' : 'px-3'}`}>
        <img
          src="/Cabinet_logo_color.png"
          alt="Cabinet"
          className={`object-contain transition-all duration-200 ${collapsed ? 'h-10 w-10' : 'h-20 w-20'}`}
        />
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-1">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
            className={`w-full flex items-center transition-colors text-sm font-medium ${
              collapsed ? 'justify-center px-0 py-3' : 'text-left px-4 py-2.5'
            } ${activePage === item.id ? activeBg + ' border-r-2 border-blue-500' : text + ' ' + hover}`}
          >
            {collapsed ? (
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
            ) : (
              item.label
            )}
          </button>
        ))}

        {/* Divider before projects */}
        <div className={`my-1 border-t ${border} ${collapsed ? 'mx-2' : 'mx-4'}`} />

        {/* Project list */}
        {!collapsed && (
          <div className="px-4 py-1">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Projects
              </span>
              <button onClick={addProject} className={`text-xs transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`} title="New project">
                +
              </button>
            </div>
            {projects.map(p => (
              <div key={p.id} className="group flex items-center">
                <button
                  onClick={() => toggleExpand(p.id)}
                  className={`flex-1 text-left text-xs py-1.5 flex items-center gap-1 transition-colors ${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  <span className="transition-transform" style={{ transform: expanded.has(p.id) ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                    &#9656;
                  </span>
                  <span className="truncate">{p.name}</span>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); if (confirm(`Delete project "${p.name}"?`)) deleteProject(p.id); }}
                  className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  aria-label={`Delete ${p.name}`}
                >&times;</button>
                {expanded.has(p.id) && (
                  <div className="ml-4 space-y-0.5 mb-1">
                    {p.sessions.length === 0 ? (
                      <p className="text-xs text-gray-500 italic py-1">No sessions</p>
                    ) : (
                      p.sessions.map(s => (
                        <button
                          key={s.id}
                          onClick={() => onNavigateToSession?.(s.id)}
                          className={`w-full text-left text-xs py-1 px-2 rounded truncate transition-colors ${isDark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
                        >
                          {s.title}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Bottom bar: Settings + Collapse toggle */}
      <div className={`border-t ${border}`}>
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          className={`w-full flex items-center transition-colors text-sm font-medium ${
            collapsed ? 'justify-center px-0 py-3' : 'text-left px-4 py-2.5'
          } ${activePage === 'settings' ? activeBg + ' border-r-2 border-blue-500' : text + ' ' + hover}`}
        >
          {collapsed ? (
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="3" />
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 .9M10.2 10.3l1 .9M2.8 11.2l1-.9M10.2 3.7l1-.9" />
            </svg>
          ) : (
            'Settings'
          )}
        </button>
        <div className={`py-1 border-t ${border}`}>
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center justify-center py-2 transition-colors ${
              isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {collapsed
                ? <path d="M5 2l6 5-6 5" />
                : <path d="M8 2l-5 5 5 5" />
              }
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
