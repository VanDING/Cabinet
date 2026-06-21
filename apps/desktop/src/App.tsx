import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  startTransition,
} from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { TitleBar } from './components/TitleBar';
import { ChatPanel } from './components/ChatPanel';
import { SecretaryOrb } from './components/SecretaryOrb';

import { NotificationManager } from './components/NotificationManager';
import { ModalOverlay } from './components/ModalOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ServerLoading } from './components/ServerLoading';
import { useTheme } from './hooks/useTheme';
import { useToast } from './components/Toast';
import { useNotifications } from './components/NotificationContext';
import { useWebSocket } from './hooks/useWebSocket';
import { MobileNav } from './components/MobileNav';
import { addToEventBuffer } from './utils/eventBuffer.js';
import { authJsonHeaders } from './utils/api.js';
import { useEventBus } from './contexts/EventBusContext';
import { ProjectExplorer } from './components/ProjectExplorer';
import { apiFetch } from './utils/api.js';
import { FileViewer } from './components/FileViewer';
import { useChat } from './contexts/ChatContext';
import { useProject } from './contexts/ProjectContext';
import { useLayout } from './contexts/LayoutContext';

// Lazy-loaded pages
const OfficePage = lazy(() =>
  import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })),
);
const FactoryPage = lazy(() =>
  import('./pages/FactoryPage').then((m) => ({ default: m.FactoryPage })),
);
const WorkflowsPage = lazy(() =>
  import('./pages/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const EmployeesPage = lazy(() =>
  import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
);
// AgentManagerPage merged into EmployeesPage. RuntimeDashboard merged into OfficePage Widgets.

const MemoryPage = lazy(() =>
  import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })),
);
const WorkbenchPage = lazy(() =>
  import('./pages/Workbench/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
);
const ChatView = lazy(() => import('./components/ChatView').then((m) => ({ default: m.ChatView })));
const ProjectPage = lazy(() =>
  import('./pages/ProjectPage').then((m) => ({ default: m.ProjectPage })),
);

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-content-tertiary text-center">
        <div className="border-accent mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-xs">Loading...</p>
      </div>
    </div>
  );
}

export function App() {
  const { theme, themes, setTheme } = useTheme();
  const { addToast } = useToast();
  const { addNotification } = useNotifications();
  const prevWsConnected = useRef(false);
  const { emit } = useEventBus();

  const {
    sessions,
    activeSession,
    history,
    uiMode,
    setUIMode,
    activeAgent,
    setActiveAgent,
    agents,
    sidebarOpen,
    setSidebarOpen,
    isSessionActive,
    handleSend,
    handleCreateSession,
    handleStop,
    handleEnterChat,
    createSession,
    switchSession,
    addFile,
    removeFile,
    editMessage,
    forkSession,
    closeSession,
    reopenSession,
    deleteHistorySession,
    updateSubAgentEvents,
    updateSubAgentStatus,
    getChildSessions,
    inputTarget,
    setInputTarget,
  } = useChat();

  const {
    projects,
    activeProjectId,
    deleteProject,
    renameProject,
    switchProject,
    showProjectActionModal,
    setShowProjectActionModal,
    createProject,
    handleImportProject,
    handleOpenProjectActionModal,
  } = useProject();

  const [projectNameInput, setProjectNameInput] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Resolve the active agent's external CLI command (if any) for terminal spawning
  const [resolvedEnv, setResolvedEnv] = useState<Record<string, string> | undefined>(undefined);
  const activeExternalAgent = useMemo(() => {
    const agent = agents.find((a) => a.id === activeAgent);
    if (!agent || agent.source !== 'external_cli') return null;
    const ext = agent.external;
    if (!ext?.command)
      return {
        command: agent.id.replace('external_cli:', ''),
        args: [],
        env: undefined,
        dispatchProtocol: undefined,
      };
    return {
      command: ext.command,
      args: ext.args ?? [],
      env: resolvedEnv ?? ext.env,
      dispatchProtocol: ext.dispatchProtocol,
    };
  }, [agents, activeAgent, resolvedEnv]);

  useEffect(() => {
    if (!activeAgent || !activeAgent.startsWith('external_cli:')) {
      setResolvedEnv(undefined);
      return;
    }
    const controller = new AbortController();
    apiFetch(`/api/workbench/agents/${encodeURIComponent(activeAgent)}/env`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setResolvedEnv((data as { env: Record<string, string> }).env))
      .catch(() => {
        /* best-effort */
      });
    return () => controller.abort();
  }, [activeAgent]);

  const {
    activePage,
    sidebarCollapsed,
    sidebarWidth,
    navigate,
    navigateToProject,
    toggleSidebar,
    setSidebarWidth,
  } = useLayout();

  const isActiveSessionProcessing = activeSession ? isSessionActive(activeSession.id) : false;
  const isChatVisible = uiMode === 'chat';

  const handleOrbOpen = useCallback(() => {
    setUIMode('chat');
  }, [setUIMode]);

  const handlePanelClose = useCallback(() => {
    setUIMode('idle');
  }, [setUIMode]);

  const handleNavigate = useCallback(
    (page: NavPage) => {
      navigate(page);
      if (uiMode === 'chat') setUIMode('browse');
    },
    [navigate, uiMode, setUIMode],
  );

  const handleNavigateToProject = useCallback(
    (projectId: string) => {
      switchProject(projectId);
      navigateToProject(projectId);
    },
    [switchProject, navigateToProject],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b') {
          e.preventDefault();
          toggleSidebar();
        }
        if (e.key === 'n') {
          e.preventDefault();
          handleCreateSession();
        }
        if (e.key === 'k') {
          e.preventDefault();
          navigate('office');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebar, handleCreateSession, navigate]);

  // WebSocket for real-time events — batched as low-priority updates
  const { connected: wsConnected } = useWebSocket((type, data) => {
    // Buffer event for late-mounting widgets
    addToEventBuffer(type, data.data ?? {});
    // Emit via EventBus for new-style listeners
    emit(type, data);
    // Also dispatch project_deleted without prefix for legacy listeners
    if (type === 'project_deleted') {
      window.dispatchEvent(new CustomEvent('project_deleted', { detail: data.data?.name }));
    }
    // Keep ws: prefixed window events for backward compatibility (deprecated)
    window.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: data }));
    // Handle sub-agent execution events
    if (type === 'agent_event' && data?.sessionId && data?.event) {
      try {
        const event = data.event as import('./types/agent-events').AgentEvent;
        updateSubAgentEvents(data.sessionId as string, event);
        if (event.type === 'completed') {
          updateSubAgentStatus(data.sessionId as string, 'completed');
          if (activeSession) {
            setInputTarget({ type: 'secretary', sessionId: activeSession.id });
          }
        } else if (event.type === 'error') {
          updateSubAgentStatus(data.sessionId as string, 'error');
          if (activeSession) {
            setInputTarget({ type: 'secretary', sessionId: activeSession.id });
          }
        } else if (event.type === 'status') {
          updateSubAgentStatus(
            data.sessionId as string,
            event.status === 'running' ? 'active' : event.status,
          );
          if (event.status === 'waiting_for_user') {
            setInputTarget({
              type: 'subagent',
              sessionId: data.sessionId as string,
              agentId: 'organize',
            });
          }
        }
      } catch {
        /* ignore malformed agent_event */
      }
    }
    startTransition(() => {
      if (type === 'decision_created')
        addNotification('decision', 'Decision created', data.data?.title ?? 'Untitled');
      if (type === 'decision_updated')
        addNotification(
          'decision',
          `Decision ${data.data?.status ?? 'updated'}`,
          data.data?.title ?? 'Untitled',
        );
      if (type === 'task_completed')
        addNotification('task', 'Task completed', data.data?.name ?? 'Untitled');
      if (type === 'project_created')
        addNotification('project', 'Project created', data.data?.name ?? 'Untitled');
      if (type === 'project_deleted')
        addNotification('project', 'Project deleted', data.data?.name ?? 'Untitled');
      if (type === 'workflow_started')
        addNotification('workflow', 'Workflow started', data.data?.name ?? 'Untitled');
      if (type === 'workflow_completed')
        addNotification('workflow', 'Workflow completed', data.data?.name ?? 'Untitled');
      if (type === 'deliverable_created')
        addNotification('deliverable', 'Deliverable created', data.data?.title ?? 'Untitled');
      if (type === 'task_updated')
        addNotification(
          'task',
          `Task ${data.data?.status ?? 'updated'}`,
          data.data?.title ?? 'Untitled',
        );
      if (type === 'budget_alert')
        addNotification('system', 'Budget alert', data.data?.reason ?? 'Budget limit exceeded');
      if (type === 'quality_alert')
        addNotification(
          'system',
          `Quality review — score ${data.data?.score ?? 'N/A'}`,
          data.data?.topIssue ?? 'Review issues detected',
        );
      if (type === 'subconscious_insight')
        addNotification('system', 'Insight', data.data?.text ?? 'A new insight surfaced');
      if (type === 'memory_contradiction')
        addNotification(
          'system',
          'Memory contradiction',
          data.data?.message ?? 'A memory conflict was detected',
        );
      if (type === 'skill_created')
        addNotification('system', 'Skill imported', data.data?.name ?? 'New skill');
      if (type === 'skill_updated')
        addNotification('system', 'Skill updated', data.data?.name ?? 'Skill');
      if (type === 'skill_deleted')
        addNotification('system', 'Skill deleted', data.data?.name ?? 'Skill');
      if (type === 'agent_created')
        addNotification('system', 'Agent imported', data.data?.name ?? 'New agent');
      if (type === 'agent_updated')
        addNotification('system', 'Agent updated', data.data?.name ?? 'Agent');
      if (type === 'agent_deleted')
        addNotification('system', 'Agent deleted', data.data?.name ?? 'Agent');
    });
  });

  // Toast on WebSocket disconnect / reconnect
  const wasEverConnected = useRef(false);
  useEffect(() => {
    if (wasEverConnected.current && !wsConnected) {
      addToast('warning', 'Real-time connection lost. Reconnecting...');
    }
    if (wasEverConnected.current && wsConnected && !prevWsConnected.current) {
      addToast('success', 'Real-time connection restored.');
    }
    if (wsConnected) wasEverConnected.current = true;
    prevWsConnected.current = wsConnected;
  }, [wsConnected, addToast]);

  return (
    <ServerLoading>
      <div className="flex h-screen flex-col overflow-hidden" data-ui-mode={uiMode}>
        {/* Custom Title Bar */}
        <TitleBar themes={themes} currentTheme={theme} onSetTheme={setTheme} />

        {/* Main body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="hidden h-full md:block">
            <Navigation
              activePage={activePage}
              onNavigate={handleNavigate}
              collapsed={sidebarCollapsed}
              onToggleCollapse={toggleSidebar}
              onNavigateToSession={(sessionId) => {
                switchSession(sessionId);
                setUIMode('chat');
              }}
              onNavigateToProject={handleNavigateToProject}
              activeProjectId={activeProjectId}
              projects={projects}
              onNewProject={handleOpenProjectActionModal}
              onDeleteProject={deleteProject}
              onRenameProject={renameProject}
              sidebarWidth={sidebarCollapsed ? undefined : sidebarWidth}
            />
          </div>

          {/* Resize handle — only when sidebar is expanded */}
          {!sidebarCollapsed && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = sidebarWidth;
                const onMove = (ev: MouseEvent) => {
                  const next = Math.max(120, Math.min(400, startW + ev.clientX - startX));
                  setSidebarWidth(next);
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
              className="bg-surface-muted hover:bg-accent:bg-accent w-1 shrink-0 cursor-col-resize transition-colors"
            />
          )}

          <ProjectExplorer
            projectId={activeProjectId}
            projectName={projects.find((p) => p.id === activeProjectId)?.name}
            onAddFile={addFile}
            activeSessionId={activeSession?.id}
          />

          {/* Main content area (relative for floating ChatPanel) */}
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Content: browse pages or chat view */}
            <div className="relative min-h-0 flex-1">
              <div
                className={`h-full overflow-auto ${uiMode === 'chat' && activeSession ? 'hidden' : ''}`}
              >
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<OfficePage />} />
                      <Route path="/office" element={<OfficePage />} />
                      <Route path="/project/:id" element={<ProjectPage />} />
                      <Route path="/workflows" element={<WorkflowsPage />} />
                      <Route
                        path="/workflows/:id/edit"
                        element={
                          <FactoryPage
                            onCreateChatSession={(options) => {
                              const id = createSession(options);
                              setUIMode('chat');
                              return id;
                            }}
                            onSwitchSession={(id) => {
                              switchSession(id);
                              setUIMode('chat');
                            }}
                            onEnterChat={handleEnterChat}
                          />
                        }
                      />
                      <Route path="/skills" element={<Navigate to="/workbench" replace />} />
                      <Route path="/workbench" element={<WorkbenchPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route
                        path="/employees"
                        element={<EmployeesPage activeProjectId={activeProjectId} />}
                      />
                      <Route path="/memory" element={<MemoryPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </div>
              {uiMode === 'chat' && activeSession && (
                <div className="chat-viewport">
                  <ErrorBoundary>
                    <Suspense fallback={<PageLoader />}>
                      <ChatView
                        messages={activeSession.messages}
                        isProcessing={isActiveSessionProcessing}
                        attachedFiles={activeSession.attachedFiles}
                        sessionTitle={activeSession.title}
                        onEditMessage={(msgId, newContent) => {
                          editMessage(activeSession.id, msgId, newContent);
                          handleSend(activeSession.id, newContent, activeSession.attachedFiles);
                        }}
                        onRegenerate={(msgId) => {
                          const idx = activeSession.messages.findIndex((m) => m.id === msgId);
                          if (idx > 0) {
                            const prevUser = activeSession.messages
                              .slice(0, idx)
                              .reverse()
                              .find((m) => m.role === 'user');
                            if (prevUser)
                              handleSend(
                                activeSession.id,
                                prevUser.content,
                                activeSession.attachedFiles,
                              );
                          }
                        }}
                        onForkMessage={(msgId) => {
                          const forkedId = forkSession(activeSession.id, msgId);
                          if (forkedId) {
                            addToast('success', 'Forked to new session');
                          }
                        }}
                        onContinue={(msgId) => {
                          handleSend(
                            activeSession.id,
                            'Please continue to complete the above tasks',
                            activeSession.attachedFiles,
                          );
                        }}
                        childSessions={getChildSessions(activeSession.id)}
                        onSubAgentClick={(sessionId) => {
                          const child = sessions.find((s) => s.id === sessionId);
                          if (child) {
                            setInputTarget({
                              type: 'subagent',
                              sessionId: child.id,
                              agentId: child.agentType ?? 'unknown',
                            });
                          }
                        }}
                        onSubAgentApprove={(sessionId) => {
                          apiFetch('/api/secretary/subagent/input', {
                            method: 'POST',
                            headers: authJsonHeaders(),
                            body: JSON.stringify({
                              subAgentSessionId: sessionId,
                              input: 'approved',
                            }),
                          })
                            .then(() => {
                              // Route back to secretary after approval
                              if (activeSession) {
                                setInputTarget({ type: 'secretary', sessionId: activeSession.id });
                              }
                            })
                            .catch(() => {
                              addToast('error', 'Failed to approve sub-agent');
                            });
                        }}
                        onResetInputTarget={() => {
                          if (activeSession) {
                            setInputTarget({ type: 'secretary', sessionId: activeSession.id });
                          }
                        }}
                        onBack={() => setUIMode('browse')}
                        agents={agents}
                        activeAgentId={activeAgent}
                        onSelectAgent={setActiveAgent}
                        allSessions={sessions}
                        sidebarOpen={sidebarOpen}
                        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                        onSelectSession={switchSession}
                        activeSessionId={activeSession?.id ?? null}
                        terminalOpen={terminalOpen}
                        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
                        activeExternalAgent={activeExternalAgent}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              )}
            </div>

            {/* Floating ChatPanel at the bottom of main content area */}
            {uiMode === 'chat' && (
              <ChatPanel
                sessions={sessions}
                activeSession={activeSession}
                history={history}
                isSessionActive={isSessionActive}
                onCreateSession={handleCreateSession}
                onCloseSession={closeSession}
                onSwitchSession={(id) => {
                  const targetSession = sessions.find((s) => s.id === id);
                  if (targetSession?.projectId) {
                    switchProject(targetSession.projectId);
                  }
                  switchSession(id);
                  setUIMode('chat');
                }}
                onAddFile={addFile}
                onRemoveFile={removeFile}
                onReopenSession={reopenSession}
                onDeleteHistorySession={deleteHistorySession}
                onSend={handleSend}
                onEnterChat={handleEnterChat}
                isProcessing={isActiveSessionProcessing}
                onStop={handleStop}
                activeProjectId={activeProjectId}
                projects={projects}
                onSwitchProject={(id) => switchProject(id)}
                onNewProject={handleOpenProjectActionModal}
                activeAgent={activeAgent}
                onAgentChange={setActiveAgent}
                inputTarget={inputTarget}
                onInputTargetChange={setInputTarget}
                activeSessionId={activeSession?.id ?? null}
                onMinimize={handlePanelClose}
              />
            )}
          </div>

          <FileViewer />
        </div>

        {/* Mobile bottom nav */}
        <MobileNav activePage={activePage} onNavigate={handleNavigate} />

        {/* Secretary Orb */}
        {uiMode === 'idle' && <SecretaryOrb onOpen={handleOrbOpen} uiMode={uiMode} />}

        {/* Notification Bubbles — only when ChatPanel is open (no orb visible) */}
        {uiMode === 'chat' && <NotificationManager />}

        {/* Overlay Chat Panel removed */}

        {/* Project action modal */}
        <ModalOverlay
          isOpen={showProjectActionModal}
          onClose={() => {
            setShowProjectActionModal(false);
            setShowCreateForm(false);
            setProjectNameInput('');
          }}
          contentClassName="mx-4 w-full max-w-sm rounded-xl border border-border bg-surface-overlay p-6 shadow-2xl"
        >
          <h3 className="text-content-primary mb-4 text-lg font-semibold">
            {showCreateForm ? 'New Project' : 'Add / Open Project'}
          </h3>

          {showCreateForm ? (
            /* ── Create project form ── */
            <div className="space-y-4">
              <input
                autoFocus
                value={projectNameInput}
                onChange={(e) => setProjectNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const name = projectNameInput.trim();
                    if (name) {
                      createProject(name).then((id) => {
                        if (id) {
                          switchProject(id);
                        }
                        setShowProjectActionModal(false);
                        setShowCreateForm(false);
                        setProjectNameInput('');
                      });
                    }
                  }
                }}
                placeholder="Project name"
                className="border-border bg-surface-input text-content-primary placeholder:text-content-tertiary focus:border-accent w-full rounded-lg border px-3 py-2 text-sm outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const name = projectNameInput.trim();
                    if (name) {
                      createProject(name).then((id) => {
                        if (id) {
                          switchProject(id);
                        }
                        setShowProjectActionModal(false);
                        setShowCreateForm(false);
                        setProjectNameInput('');
                      });
                    }
                  }}
                  disabled={!projectNameInput.trim()}
                  className="bg-accent text-accent-foreground flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setProjectNameInput('');
                  }}
                  className="border-border text-content-secondary hover:bg-surface-elevated rounded-lg border px-3 py-2 text-sm transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            /* ── Main modal: actions + recent projects ── */
            <div className="space-y-3">
              <button
                onClick={() => setShowCreateForm(true)}
                className="border-border hover:bg-surface-elevated bg-surface-input w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors"
              >
                <span className="text-content-primary block text-base">Create New Project</span>
                <span className="text-content-tertiary mt-0.5 block text-xs">
                  Start with an empty project
                </span>
              </button>

              {projects.length > 0 && (
                <>
                  <div className="flex items-center gap-2 py-1">
                    <div className="bg-surface-muted h-px flex-1" />
                    <span className="text-content-tertiary text-[10px]">RECENT PROJECTS</span>
                    <div className="bg-surface-muted h-px flex-1" />
                  </div>
                  <div className="max-h-48 space-y-1 overflow-auto">
                    {[...projects]
                      .sort((a, b) => {
                        if (!a.lastActivityAt) return 1;
                        if (!b.lastActivityAt) return -1;
                        return (
                          new Date(b.lastActivityAt).getTime() -
                          new Date(a.lastActivityAt).getTime()
                        );
                      })
                      .slice(0, 8)
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            switchProject(p.id);
                            setShowProjectActionModal(false);
                          }}
                          className={`hover:bg-surface-elevated flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                            p.id === activeProjectId ? 'bg-surface-input' : ''
                          }`}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-content-tertiary shrink-0"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span className="text-content-primary flex-1 truncate">{p.name}</span>
                          {p.id === activeProjectId && (
                            <span className="text-accent text-[10px] font-medium">ACTIVE</span>
                          )}
                        </button>
                      ))}
                  </div>
                </>
              )}

              <button
                onClick={() => {
                  setShowProjectActionModal(false);
                  handleImportProject();
                }}
                className="border-border hover:bg-surface-elevated bg-surface-input w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors"
              >
                <span className="text-content-primary block text-base">Import Existing Folder</span>
                <span className="text-content-tertiary mt-0.5 block text-xs">
                  Import a local folder as project
                </span>
              </button>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => {
                setShowProjectActionModal(false);
                setShowCreateForm(false);
                setProjectNameInput('');
              }}
              className="border-border text-content-secondary rounded-sm border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </ModalOverlay>
      </div>
    </ServerLoading>
  );
}
