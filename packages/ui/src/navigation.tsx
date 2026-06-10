import { useState } from 'react';
import { Command, Workflow, UserRound, Brain, Compass } from 'lucide-react';

export type NavPage = 'office' | 'workflows' | 'employees' | 'memory' | 'discovery' | 'settings';

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

const navItems: { id: NavPage; label: string }[] = [
  { id: 'office', label: 'Office' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'employees', label: 'Employees' },
  { id: 'memory', label: 'Memory' },
  { id: 'discovery', label: 'Discovery' },
];

const navIcons: Partial<Record<NavPage, typeof Command>> = {
  office: Command,
  workflows: Workflow,
  employees: UserRound,
  memory: Brain,
  discovery: Compass,
};

const sidebarBgClasses = 'bg-surface-primary';
const borderClasses = 'border-border';
const textMutedClasses = 'text-content-tertiary';
const activeClasses =
  'bg-accent-muted text-accent border-r-2 border-accent';
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
      className={`flex h-full shrink-0 flex-col border-r transition-all duration-200 ${sidebarW} ${sidebarBgClasses} ${borderClasses}`}
      style={sidebarStyle}
    >
      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-1">
        {navItems.map((item) => {
          const Icon = navIcons[item.id];
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              aria-current={activePage === item.id ? 'page' : undefined}
              className={`flex w-full items-center text-sm font-medium transition-colors ${
                collapsed ? 'justify-center px-0 py-3' : 'px-4 py-2.5 text-left'
              } ${activePage === item.id ? activeClasses : `${textMutedClasses} ${hoverClasses}`}`}
            >
              {collapsed && Icon ? (
                <Icon size={18} strokeWidth={1.5} />
              ) : (
                item.label
              )}
            </button>
          );
        })}

        {/* Divider before projects */}
        <div className={`my-1 border-t ${borderClasses} ${collapsed ? 'mx-2' : 'mx-4'}`} />

        {/* Project list */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 py-1">
            {projects
              .filter((p) => !(p as any).archived)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => onNavigateToProject?.(p.id)}
                  title={p.name}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                    activeProjectId === p.id
                      ? 'bg-accent text-white'
                      : 'bg-surface-muted text-content-secondary hover:bg-surface-elevated'
                  }`}
                >
                  {p.name.trim().charAt(0).toUpperCase()}
                </button>
              ))}
            <button
              onClick={onNewProject}
              title="New project"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs text-content-tertiary transition-colors hover:bg-surface-muted hover:text-content-secondary"
            >
              +
            </button>
          </div>
        ) : (
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
                        className="flex-1 rounded-sm border border-border bg-surface-primary px-1 py-0.5 text-xs text-content-primary"
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
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            (p as any).activeWorkflowCount > 0 ? 'bg-intent-success' : 'bg-surface-input'
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
                      className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-xs text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-intent-danger"
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
