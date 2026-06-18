import { useCallback, useEffect, useRef, useState, lazy, Suspense, startTransition } from 'react';
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
const DiscoveryPage = lazy(() =>
  import('./pages/DiscoveryPage').then((m) => ({ default: m.DiscoveryPage })),
);
const ChatView = lazy(() => import('./components/ChatView').then((m) => ({ default: m.ChatView })));
const ProjectWorkplace = lazy(() =>
  import('./pages/ProjectWorkplace').then((m) => ({ default: m.ProjectWorkplace })),
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
  const location = useLocation();
  const isProjectWorkplace = location.pathname.startsWith('/project/');
  const { theme, themes, setTheme } = useTheme();
  const { addToast } = useToast();
  const { addNotification } = useNotifications();
  const prevWsConnected = useRef(false);
  const { emit } = useEventBus();

  const {
    sessions,
    activeSession,
    history,
    chatMode,
    setChatMode,
    uiMode,
    setUIMode,
    activeAgent,
    setActiveAgent,
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
    handleCreateNewProject,
    handleImportProject,
    handleOpenProjectActionModal,
  } = useProject();

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

  /* ── Orb ↔ ChatPanel slide transition ── */
  const [transitionPhase, setTransitionPhase] = useState<null | 'opening' | 'closing'>(null);
  const isTransitioning = transitionPhase !== null;

  const handleOrbOpen = useCallback(() => {
    if (transitionPhase !== null) return;
    setTransitionPhase('opening');
    setTimeout(() => {
      setUIMode('work');
      setTransitionPhase(null);
    }, 450);
  }, [transitionPhase, setUIMode]);

  const handlePanelClose = useCallback(() => {
    if (transitionPhase !== null) {
      setUIMode('idle');
      return;
    }
    setTransitionPhase('closing');
    setTimeout(() => {
      setUIMode('idle');
      setTransitionPhase(null);
    }, 450);
  }, [transitionPhase, setUIMode]);

  const handleNavigate = useCallback(
    (page: NavPage) => {
      navigate(page);
      switchProject(null);
      if (uiMode === 'chat') setUIMode('work');
    },
    [navigate, switchProject, uiMode, setUIMode],
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
      <div
        className={`flex h-screen flex-col overflow-hidden ${transitionPhase || ''}`}
        data-ui-mode={uiMode}
      >
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
                setChatMode(true);
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

          {/* Project Explorer — hidden when inside ProjectWorkplace */}
          {!isProjectWorkplace && (
            <ProjectExplorer
              projectId={activeProjectId}
              projectName={projects.find((p) => p.id === activeProjectId)?.name}
              onAddFile={addFile}
              activeSessionId={activeSession?.id}
            />
          )}

          {/* Main content area (relative for floating ChatPanel) */}
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Content: browse pages or chat view */}
            <div className="relative min-h-0 flex-1">
              {/* Keep pages mounted (hidden) so WebSocket listeners stay active */}
              <div
                className={`page-viewport h-full overflow-auto ${uiMode === 'chat' && activeSession ? 'page-hidden' : ''}`}
              >
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<Navigate to="/workflows" replace />} />
                      <Route path="/office" element={<Navigate to="/workflows" replace />} />
                      <Route path="/project/:id" element={<ProjectWorkplace />} />
                      <Route path="/workflows" element={<WorkflowsPage />} />
                      <Route
                        path="/workflows/:id/edit"
                        element={
                          <FactoryPage
                            onCreateChatSession={(options) => {
                              const id = createSession(options);
                              setChatMode(true);
                              return id;
                            }}
                            onSwitchSession={(id) => {
                              switchSession(id);
                              setChatMode(true);
                            }}
                            onEnterChat={handleEnterChat}
                          />
                        }
                      />
                      <Route path="/skills" element={<Navigate to="/discovery" replace />} />
                      <Route path="/discovery" element={<DiscoveryPage />} />
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
                        onBack={() => setUIMode('work')}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              )}
            </div>

            {/* Floating ChatPanel at the bottom of main content area */}
            {(uiMode !== 'idle' || isTransitioning) && (
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
                  setChatMode(true);
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

          {/* File Viewer — third column, right side; hidden when inside ProjectWorkplace */}
          {!isProjectWorkplace && <FileViewer />}
        </div>

        {/* Mobile bottom nav */}
        <MobileNav activePage={activePage} onNavigate={handleNavigate} />

        {/* Secretary Orb */}
        {(uiMode === 'idle' || isTransitioning) && (
          <SecretaryOrb onOpen={handleOrbOpen} uiMode={uiMode} />
        )}

        {/* Notification Bubbles — only when ChatPanel is open (no orb visible) */}
        {uiMode === 'chat' && <NotificationManager />}

        {/* Overlay Chat Panel removed */}

        {/* Project action modal */}
        <ModalOverlay
          isOpen={showProjectActionModal}
          onClose={() => setShowProjectActionModal(false)}
          contentClassName="mx-4 w-full max-w-sm rounded-xl border border-border bg-surface-overlay p-6 shadow-2xl"
        >
          <h3 className="text-content-primary mb-4 text-lg font-semibold">Add Project</h3>
          <div className="space-y-3">
            <button
              onClick={() => {
                setShowProjectActionModal(false);
                handleCreateNewProject();
              }}
              className="border-border hover:bg-surface-elevated bg-surface-input w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors"
            >
              <span className="text-content-primary block text-base">Create New Project</span>
              <span className="text-content-tertiary mt-0.5 block text-xs">
                Start with an empty project
              </span>
            </button>
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
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setShowProjectActionModal(false)}
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
