import { useState } from 'react';

export type NavPage = 'office' | 'factory' | 'employees' | 'memory' | 'settings';

interface ProjectInfo {
  id: string;
  name: string;
  lastActivityAt?: string;
  activeWorkflowCount?: number;
  rootPath?: string;
}

export interface NavigationProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigateToSession?: (sessionId: string) => void;
  onNavigateToProject?: (projectId: string) => void;
  activeProjectId?: string | null;
  projects?: ProjectInfo[];
  onNewProject?: () => void;
  onDeleteProject?: (projectId: string, name: string) => void;
  onRenameProject?: (projectId: string, name: string) => void;
  sidebarWidth?: number;
}

const navItems: { id: NavPage; label: string; icon: string }[] = [
  {
    id: 'office',
    label: 'Office',
    icon: 'M2 3h10a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z',
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

const sidebarBgClasses = 'bg-surface-primary';
const borderClasses = 'border-border';
const textMutedClasses = 'text-content-tertiary';
const activeClasses =
  'bg-blue-50 text-accent border-r-2 border-accent';
const hoverClasses = 'hover:bg-surface-muted hover:text-content-secondary';

export function Navigation({
  activePage,
  onNavigate,
  collapsed,
  onToggleCollapse,
  onNavigateToSession,
  onNavigateToProject,
  activeProjectId,
  projects = [],
  onNewProject,
  onDeleteProject,
  onRenameProject,
  sidebarWidth,
}: NavigationProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const sidebarW = collapsed ? 'w-12' : sidebarWidth ? '' : 'w-40';
  const sidebarStyle = !collapsed && sidebarWidth ? { width: `${sidebarWidth}px` } : undefined;

  return (
    <nav
      aria-label="Main navigation"
      className={`flex h-full flex-shrink-0 flex-col border-r transition-all duration-200 ${sidebarW} ${sidebarBgClasses} ${borderClasses}`}
      style={sidebarStyle}
    >
      {/* Logo */}
      <div className={`flex justify-center py-3 ${collapsed ? 'px-1' : 'px-3'}`}>
        <img
          src="/Cabinet_logo_color.png"
          alt="Cabinet"
          className={`object-contain transition-all duration-200 ${collapsed ? 'h-12 w-12' : 'h-24 w-24'}`}
        />
        <img
          src="/Cabinet_logo_darkcolor.png"
          alt="Cabinet"
          className={`hidden object-contain transition-all duration-200 ${collapsed ? 'h-12 w-12' : 'h-24 w-24'}`}
        />
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-label={item.label}
            aria-current={activePage === item.id ? 'page' : undefined}
            className={`flex w-full items-center text-sm font-medium transition-colors ${
              collapsed ? 'justify-center px-0 py-3' : 'px-4 py-2.5 text-left'
            } ${activePage === item.id ? activeClasses : `${textMutedClasses} ${hoverClasses}`}`}
          >
            {collapsed ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>
            ) : (
              item.label
            )}
          </button>
        ))}

        {/* Divider before projects */}
        <div className={`my-1 border-t ${borderClasses} ${collapsed ? 'mx-2' : 'mx-4'}`} />

        {/* Project list */}
        {!collapsed && (
          <div className="px-4 py-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider uppercase text-content-tertiary">
                Projects
              </span>
              <button
                onClick={onNewProject}
                className="text-xs text-content-tertiary transition-colors hover:text-content-secondary"
                title="New project"
              >
                +
              </button>
            </div>
            {projects.filter((p) => !(p as any).archived).length === 0 ? (
              <p className="py-1 text-xs text-content-tertiary italic">No projects</p>
            ) : (
              projects
                .filter((p) => !(p as any).archived)
                .map((p) => (
                  <div key={p.id} className="group flex items-center">
                    {renamingId === p.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => {
                          if (renameValue.trim() && renameValue.trim() !== p.name) {
                            onRenameProject?.(p.id, renameValue.trim());
                          }
                          setRenamingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (renameValue.trim() && renameValue.trim() !== p.name) {
                              onRenameProject?.(p.id, renameValue.trim());
                            }
                            setRenamingId(null);
                          }
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="flex-1 rounded border bg-surface-primary px-1 py-0.5 text-xs text-content-primary"
                      />
                    ) : (
                      <button
                        onClick={() => onNavigateToProject?.(p.id)}
                        onDoubleClick={() => {
                          setRenamingId(p.id);
                          setRenameValue(p.name);
                        }}
                        className={`flex flex-1 items-center gap-1 py-1.5 text-left text-xs transition-colors ${
                          activeProjectId === p.id
                            ? 'font-medium text-accent'
                            : 'text-content-secondary hover:text-content-primary'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                            (p as any).activeWorkflowCount > 0 ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        <span className="truncate">{p.name}</span>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete project "${p.name}"?`)) return;
                        onDeleteProject?.(p.id, p.name);
                      }}
                      className="ml-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-xs text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-intent-danger"
                      aria-label={`Delete ${p.name}`}
                    >
                      &times;
                    </button>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {/* Bottom bar: Settings + Collapse toggle */}
      <div className={`border-t ${borderClasses}`}>
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          className={`flex w-full items-center text-sm font-medium transition-colors ${
            collapsed ? 'justify-center px-0 py-3' : 'px-4 py-2.5 text-left'
          } ${activePage === 'settings' ? activeClasses : `${textMutedClasses} ${hoverClasses}`}`}
        >
          {collapsed ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="7" cy="7" r="3" />
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 .9M10.2 10.3l1 .9M2.8 11.2l1-.9M10.2 3.7l1-.9" />
            </svg>
          ) : (
            'Settings'
          )}
        </button>
        <div className={`border-t py-1 ${borderClasses}`}>
          <button
            onClick={onToggleCollapse}
            className="flex w-full items-center justify-center py-2 text-content-tertiary transition-colors hover:bg-surface-muted hover:text-content-secondary"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              {collapsed ? <path d="M5 2l6 5-6 5" /> : <path d="M8 2l-5 5 5 5" />}
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
