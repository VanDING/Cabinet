import { useState, useCallback, useEffect, useRef, lazy, Suspense, startTransition } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { TitleBar } from './components/TitleBar';
import { ChatPanel } from './components/ChatPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ServerLoading } from './components/ServerLoading';
import { useTheme } from './hooks/useTheme';
import { useSessions, type ChatMessage, type AttachedFile } from './hooks/useSessions';
import { useToast } from './components/Toast';
import { useNotifications } from './components/NotificationContext';
import { useWebSocket } from './hooks/useWebSocket';
import { MobileNav } from './components/MobileNav';
import { apiFetch, authJsonHeaders, authHeaders } from './utils/pin.js';
import { addToEventBuffer } from './utils/eventBuffer.js';
import type { MeetingData } from './components/MeetingCard';
import type { SubAgentActivity } from '@cabinet/ui';
import { readSSEStream } from './utils/streaming.js';
import { ProjectExplorer } from './components/ProjectExplorer';
import { FileViewer } from './components/FileViewer';

interface ProjectInfo {
  id: string;
  name: string;
  lastActivityAt?: string;
  activeWorkflowCount?: number;
  archived?: boolean;
  rootPath?: string;
}

// Lazy-loaded pages
const OfficePage = lazy(() =>
  import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })),
);
const FactoryPage = lazy(() =>
  import('./pages/FactoryPage').then((m) => ({ default: m.FactoryPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const EmployeesPage = lazy(() =>
  import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
);
const MemoryPage = lazy(() =>
  import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })),
);
const ChatView = lazy(() => import('./components/ChatView').then((m) => ({ default: m.ChatView })));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-gray-400">
        <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <p className="text-xs">Loading...</p>
      </div>
    </div>
  );
}

export function App() {
  const [activePage, setActivePage] = useState<NavPage>('office');
  const [chatMode, setChatMode] = useState(false);
  const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(160);
  const [activeAgent, setActiveAgent] = useState('secretary');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [showProjectActionModal, setShowProjectActionModal] = useState(false);
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const { addToast } = useToast();
  const { addNotification } = useNotifications();

  // Fetch projects
  const refreshProjects = useCallback(() => {
    apiFetch('/api/projects?archived=false', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  // Listen for project deletion from Navigation
  useEffect(() => {
    const handler = (e: Event) => {
      refreshProjects();
      if ((e as CustomEvent).detail === activeProjectId) setActiveProjectId(null);
    };
    window.addEventListener('project_deleted', handler);
    return () => window.removeEventListener('project_deleted', handler);
  }, [refreshProjects, activeProjectId]);

  // WebSocket for real-time events — batched as low-priority updates
  const { connected: wsConnected } = useWebSocket((type, data) => {
    // Buffer event for late-mounting widgets
    addToEventBuffer(type, data.data ?? {});
    window.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: data }));
    // Also dispatch project_deleted without prefix for Navigation listener
    if (type === 'project_deleted') {
      window.dispatchEvent(new CustomEvent('project_deleted', { detail: data.data?.name }));
    }
    startTransition(() => {
      if (type === 'decision_created') addNotification('decision', 'Decision created', data.data?.title ?? 'Untitled');
      if (type === 'decision_updated') addNotification('decision', `Decision ${data.data?.status ?? 'updated'}`, data.data?.title ?? 'Untitled');
      if (type === 'meeting_created') addNotification('meeting', 'Meeting completed', data.data?.topic ?? 'Untitled');
      if (type === 'task_completed') addNotification('task', 'Task completed', data.data?.name ?? 'Untitled');
      if (type === 'project_created') addNotification('project', 'Project created', data.data?.name ?? 'Untitled');
      if (type === 'project_deleted') addNotification('project', 'Project deleted', data.data?.name ?? 'Untitled');
      if (type === 'workflow_started') addNotification('workflow', 'Workflow started', data.data?.name ?? 'Untitled');
      if (type === 'workflow_completed') addNotification('workflow', 'Workflow completed', data.data?.name ?? 'Untitled');
      if (type === 'deliverable_created') addNotification('deliverable', 'Deliverable created', data.data?.title ?? 'Untitled');
      if (type === 'task_updated') addNotification('task', `Task ${data.data?.status ?? 'updated'}`, data.data?.title ?? 'Untitled');
      if (type === 'budget_alert') addNotification('system', 'Budget alert', data.data?.reason ?? 'Budget limit exceeded');
      if (type === 'quality_alert') addNotification('system', `Quality review — score ${data.data?.score ?? 'N/A'}`, data.data?.topIssue ?? 'Review issues detected');
      if (type === 'subconscious_insight') addNotification('system', 'Insight', data.data?.text ?? 'A new insight surfaced');
      if (type === 'memory_contradiction') addNotification('system', 'Memory contradiction', data.data?.message ?? 'A memory conflict was detected');
      if (type === 'skill_created') addNotification('system', 'Skill imported', data.data?.name ?? 'New skill');
      if (type === 'skill_updated') addNotification('system', 'Skill updated', data.data?.name ?? 'Skill');
      if (type === 'skill_deleted') addNotification('system', 'Skill deleted', data.data?.name ?? 'Skill');
      if (type === 'agent_created') addNotification('system', 'Agent imported', data.data?.name ?? 'New agent');
      if (type === 'agent_updated') addNotification('system', 'Agent updated', data.data?.name ?? 'Agent');
      if (type === 'agent_deleted') addNotification('system', 'Agent deleted', data.data?.name ?? 'Agent');
    });
  });

  // Toast on WebSocket disconnect / reconnect
  const prevWsConnected = useRef(wsConnected);
  useEffect(() => {
    if (prevWsConnected.current && !wsConnected) {
      addToast('warning', 'Real-time connection lost. Reconnecting...');
    }
    if (!prevWsConnected.current && wsConnected) {
      addToast('success', 'Real-time connection restored.');
    }
    prevWsConnected.current = wsConnected;
  }, [wsConnected, addToast]);

  const {
    sessions,
    activeSession,
    history,
    isSessionActive,
    createSession,
    closeSession,
    switchSession,
    addMessage,
    updateMessage,
    addFile,
    removeFile,
    setSessionActive,
    reopenSession,
    deleteHistorySession,
    editMessage,
    forkSession,
  } = useSessions();

  const isActiveSessionProcessing = activeSession ? processingSessions.has(activeSession.id) : false;

  const handleNavigate = useCallback(
    (page: NavPage) => {
      setActivePage(page);
      setActiveProjectId(null);
      setChatMode(false);
      navigate(`/${page === 'office' ? '' : page}`);
    },
    [navigate],
  );

  const handleNavigateToProject = useCallback(
    (projectId: string) => {
      setActiveProjectId(projectId);
      setActivePage('office' as NavPage);
      setChatMode(false);
      navigate(`/project/${projectId}/office`);
    },
    [navigate],
  );

  const handleOpenProjectActionModal = useCallback(() => {
    setShowProjectActionModal(true);
  }, []);

  const handleCreateNewProject = useCallback(async () => {
    const name = prompt('Project name:') || '';
    if (!name.trim()) return;
    try {
      const r = await apiFetch('/api/projects', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: name.trim(), rootPath: '' }),
      });
      if (r.ok) {
        const data = await r.json();
        const newProjectId = data.project?.id;
        refreshProjects();
        if (newProjectId) {
          setActiveProjectId(newProjectId);
          navigate(`/project/${newProjectId}/office`);
        }
      }
    } catch {
      addToast('error', 'Failed to create project');
    }
  }, [refreshProjects, addToast]);

  const handleImportProject = useCallback(async () => {
    let name = '';
    let rootPath = '';
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: 'Select project folder', multiple: false });
      if (selected && typeof selected === 'string') {
        rootPath = selected;
        name = selected.split(/[/\\]/).pop() || selected;
      }
    } catch { /* Tauri dialog not available */ }
    if (!name.trim()) return;
    try {
      const r = await apiFetch('/api/projects', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: name.trim(), rootPath }),
      });
      if (r.ok) {
        const data = await r.json();
        const newProjectId = data.project?.id;
        refreshProjects();
        if (newProjectId) {
          setActiveProjectId(newProjectId);
          navigate(`/project/${newProjectId}/office`);
        }
      }
    } catch {
      addToast('error', 'Failed to import project');
    }
  }, [refreshProjects, addToast]);

  const handleDeleteProject = useCallback(async (projectId: string, name: string) => {
    try {
      const r = await apiFetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (r.ok) {
        refreshProjects();
        if (projectId === activeProjectId) setActiveProjectId(null);
        // Notification handled by WebSocket broadcast (ws:project_deleted)
      }
    } catch {
      addToast('error', 'Failed to delete project');
    }
  }, [refreshProjects, activeProjectId, addToast, addNotification]);

  const handleRenameProject = useCallback(async (projectId: string, name: string) => {
    try {
      const r = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        refreshProjects();
      }
    } catch {
      addToast('error', 'Failed to rename project');
    }
  }, [refreshProjects, addToast]);

  const handleEnterChat = useCallback(() => {
    setChatMode(true);
  }, []);

  const handleCreateSession = useCallback((): string => {
    const id = createSession({ projectId: activeProjectId ?? undefined });
    setChatMode(true);
    return id;
  }, [createSession, activeProjectId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b') {
          e.preventDefault();
          setSidebarCollapsed((c) => !c);
        }
        if (e.key === 'n') {
          e.preventDefault();
          handleCreateSession();
        }
        if (e.key === 'k') {
          e.preventDefault();
          setActivePage('office');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateSession]);

  const handleStop = useCallback((sessionId: string) => {
    abortRef.current.get(sessionId)?.abort();
    abortRef.current.delete(sessionId);
  }, []);

  const handleSend = useCallback(
    async (sessionId: string, message: string, files: AttachedFile[], _dispatchMode?: string, model?: string) => {
      if (!message.trim() && files.length === 0) return;

      // Abort any in-flight request for THIS session before starting a new one
      abortRef.current.get(sessionId)?.abort();
      const controller = new AbortController();
      abortRef.current.set(sessionId, controller);

      setChatMode(true);
      setSessionActive(sessionId, true);

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      addMessage(sessionId, userMsg);
      setProcessingSessions(prev => new Set(prev).add(sessionId));

      // Always use streaming for responsive chat
      const streamId = `a_${Date.now()}`;
      try {
        const res = await apiFetch('/api/secretary/chat', {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            sessionId,
            message,
            stream: true,
            ...(activeSession?.projectId ?? activeProjectId ? { projectId: activeSession?.projectId ?? activeProjectId } : {}),
            files: files.map((f) => ({ name: f.name, path: f.path, type: f.type })),
            ...(model ? { model } : {}),
          }),
        });

        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream') && res.body) {
          const reader = res.body.getReader();

          let meetingData: MeetingData | undefined;
          let streamAgent = activeAgent;
          let thinkingAccumulated = '';
          let toolCallsAccumulated: NonNullable<ChatMessage['toolCalls']> = [];
          let lastContent = '';
          let toolsSinceLastSegment = false;
          let thinkingStart: number | undefined;
          const streamStart = Date.now();

          const subAgentMap = new Map<string, SubAgentActivity>();
          const flushSubAgents = () => {
            updateMessage(sessionId, streamId, {
              subAgentActivities: Array.from(subAgentMap.values()),
            });
          };

          const AGENT_DISPLAY: Record<string, string> = {
            secretary: 'Secretary',
            meeting_chair: 'Meeting Chair',
            workflow_designer: 'Workflow Designer',
            decision_analyst: 'Decision Analyst',
            agent_creator: 'Agent Creator',
            reviewer: 'Reviewer',
            organize: 'Organizer',
            curator: 'Curator',
          };

          // Create skeleton message once; update incrementally during streaming
          addMessage(sessionId, {
            id: streamId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
            agentName: streamAgent,
          });

          await readSSEStream(reader, {
            onRoutingStart(targetAgent) {
              const sourceDisplay = AGENT_DISPLAY[streamAgent] || streamAgent;
              const targetDisplay = AGENT_DISPLAY[targetAgent] || targetAgent;
              streamAgent = targetAgent;
              setActiveAgent(targetAgent);
              updateMessage(sessionId, streamId, {
                routing: { from: sourceDisplay, to: targetDisplay },
              });
            },
            onThinking(content) {
              if (thinkingStart === undefined) thinkingStart = Date.now();
              thinkingAccumulated += content;
              updateMessage(sessionId, streamId, {
                thinking: thinkingAccumulated,
                toolCalls: toolCallsAccumulated.length > 0 ? toolCallsAccumulated : undefined,
              });
            },
            onThinkingDone() {
              if (thinkingStart !== undefined) {
                const thinkingDurationMs = Date.now() - thinkingStart;
                updateMessage(sessionId, streamId, { thinkingDurationMs });
                thinkingStart = undefined;
              }
            },
            onContent(_, fullContent) {
              lastContent = fullContent;
              updateMessage(sessionId, streamId, {
                content: fullContent,
                thinking: thinkingAccumulated || undefined,
                toolCalls: toolCallsAccumulated.length > 0 ? toolCallsAccumulated : undefined,
              });
            },
            onTaskUpdate(tasks) {
              updateMessage(sessionId, streamId, { tasks });
            },
            onSemanticTaskUpdate(tasks) {
              updateMessage(sessionId, streamId, { semanticTasks: tasks });
            },
            onStepBudgetWarning(remaining, maxSteps) {
              updateMessage(sessionId, streamId, { stepBudget: { remaining, maxSteps } });
            },
            onToolStatus(message, type, detail) {
              toolsSinceLastSegment = true;
              const toolName = detail?.name ?? 'unknown';
              if (type === 'result') {
                const idx = toolCallsAccumulated.map(tc => tc.name === toolName && tc.status === 'running').lastIndexOf(true);
                if (idx >= 0) {
                  toolCallsAccumulated = toolCallsAccumulated.map((tc, i) =>
                    i === idx
                      ? { ...tc, status: 'completed' as const, result: typeof detail?.result === 'string' ? detail.result : JSON.stringify(detail?.result) }
                      : tc,
                  );
                } else {
                  toolCallsAccumulated = [...toolCallsAccumulated, {
                    id: `${toolName}_${Date.now()}`,
                    name: toolName,
                    status: 'completed' as const,
                    args: detail?.args as Record<string, unknown> | undefined,
                    result: typeof detail?.result === 'string' ? detail.result : JSON.stringify(detail?.result),
                  }];
                }
              } else if (type === 'error') {
                const idx = toolCallsAccumulated.map(tc => tc.name === toolName && tc.status === 'running').lastIndexOf(true);
                if (idx >= 0) {
                  toolCallsAccumulated = toolCallsAccumulated.map((tc, i) =>
                    i === idx ? { ...tc, status: 'error' as const } : tc,
                  );
                }
              } else {
                toolCallsAccumulated = [...toolCallsAccumulated, {
                  id: `${toolName}_${Date.now()}`,
                  name: toolName,
                  status: 'running' as const,
                  args: detail?.args as Record<string, unknown> | undefined,
                }];
              }
              updateMessage(sessionId, streamId, {
                thinking: thinkingAccumulated || undefined,
                toolCalls: toolCallsAccumulated,
              });
            },
            onSubAgentStart(agentName, taskDescription) {
              subAgentMap.set(agentName, {
                agentName,
                status: 'running',
                taskDescription,
                startedAt: new Date(),
              });
              flushSubAgents();
            },
            onSubAgentThinking(agentName, content) {
              const existing = subAgentMap.get(agentName);
              if (existing) {
                existing.thinking = [...(existing.thinking ?? []), content];
                flushSubAgents();
              }
            },
            onSubAgentToolCall(agentName, toolName, args) {
              const existing = subAgentMap.get(agentName);
              if (existing) {
                existing.toolCalls = [
                  ...(existing.toolCalls ?? []),
                  { name: toolName, args: args as Record<string, unknown> },
                ];
                flushSubAgents();
              }
            },
            onSubAgentDone(agentName, result) {
              const existing = subAgentMap.get(agentName);
              if (existing) {
                existing.status = 'completed';
                existing.result = result;
                existing.completedAt = new Date();
                flushSubAgents();
              }
            },
            onSubAgentError(agentName, error) {
              const existing = subAgentMap.get(agentName);
              if (existing) {
                existing.status = 'error';
                existing.error = error;
                existing.completedAt = new Date();
                flushSubAgents();
              }
            },
            onDone(fullContent, event) {
              if (event?.meeting) meetingData = event.meeting as MeetingData;
              if ((event as any)?.targetAgent) streamAgent = (event as any).targetAgent;
              flushSubAgents();
              subAgentMap.clear();
              updateMessage(sessionId, streamId, {
                content: fullContent,
                isStreaming: false,
                meeting: meetingData,
                agentName: (event as any)?.agentName ?? streamAgent,
                toolCalls: toolCallsAccumulated.length > 0 ? toolCallsAccumulated : undefined,
                durationMs: Date.now() - streamStart,
              });
            },
            onError(error) {
              flushSubAgents();
              subAgentMap.clear();
              updateMessage(sessionId, streamId, {
                content: `Error: ${error}`,
                isStreaming: false,
                isError: true,
                durationMs: Date.now() - streamStart,
              });
            },
            onRouting(targetAgent) {
              streamAgent = targetAgent;
              setActiveAgent(targetAgent);
              // routing_start already emitted prefix; no message update needed here
            },
          }, controller.signal);
        } else {
          // Fallback to JSON (non-streaming)
          const data = await res.json();
          const content = data.response ?? 'I received your message.';

          addMessage(sessionId, {
            id: streamId,
            role: 'assistant',
            content,
            timestamp: new Date(),
            meeting: data.meeting ?? undefined,
            agentName: data.agentName ?? activeAgent,
          });
        }
      } catch {
        addToast('error', 'Failed to send message. Server may be offline.');
        const session = sessions.find((s) => s.id === sessionId);
        const hasSkeleton = session?.messages.some((m) => m.id === streamId);
        if (hasSkeleton) {
          updateMessage(sessionId, streamId, {
            content: 'Sorry, I could not connect to the server.',
            isStreaming: false,
            isError: true,
          });
        } else {
          addMessage(sessionId, {
            id: `e_${Date.now()}`,
            role: 'assistant',
            content: 'Sorry, I could not connect to the server.',
            timestamp: new Date(),
            agentName: activeAgent,
            isError: true,
          });
        }
      } finally {
        if (abortRef.current.get(sessionId) === controller) abortRef.current.delete(sessionId);
        setProcessingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
        setSessionActive(sessionId, false);
      }
    },
    [addMessage, addToast, setSessionActive, setChatMode, activeProjectId, activeAgent, activeSession],
  );

  return (
    <ServerLoading>
    <div className={`flex h-screen flex-col overflow-hidden ${isDark ? 'dark' : ''}`}>
      {/* Custom Title Bar */}
      <TitleBar isDark={isDark} onToggleTheme={toggle} />

      {/* Main body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="hidden h-full md:block">
          <Navigation
            activePage={activePage}
            onNavigate={handleNavigate}
            isDark={isDark}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
            onNavigateToSession={(sessionId) => {
              switchSession(sessionId);
              setChatMode(true);
            }}
            onNavigateToProject={handleNavigateToProject}
            activeProjectId={activeProjectId}
            projects={projects}
            onNewProject={handleOpenProjectActionModal}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
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
            className={`w-1 flex-shrink-0 cursor-col-resize transition-colors ${
              isDark ? 'bg-gray-700 hover:bg-blue-500' : 'bg-gray-200 hover:bg-blue-400'
            }`}
          />
        )}

        {/* Project Explorer */}
        <ProjectExplorer
          projectId={activeProjectId}
          projectName={projects.find((p) => p.id === activeProjectId)?.name}
          isDark={isDark}
          onAddFile={addFile}
          activeSessionId={activeSession?.id}
        />

        {/* Main content area (relative for floating ChatPanel) */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden relative">
          {/* Content: browse pages or chat view */}
          <div className="flex-1 overflow-hidden">
            {/* Keep pages mounted (hidden) so WebSocket listeners stay active */}
            <div className={chatMode && activeSession ? 'hidden' : 'h-full overflow-auto'}>
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<OfficePage />} />
                    <Route path="/office" element={<OfficePage />} />
                    <Route path="/project/:id/office" element={<OfficePage />} />
                    <Route path="/project/:id/factory" element={
                      <FactoryPage
                        onCreateChatSession={(options) => createSession(options)}
                        onSwitchSession={(id) => { switchSession(id); setChatMode(true); }}
                        onEnterChat={handleEnterChat}
                      />
                    } />
                    <Route path="/factory" element={
                      <FactoryPage
                        onCreateChatSession={(options) => createSession(options)}
                        onSwitchSession={(id) => { switchSession(id); setChatMode(true); }}
                        onEnterChat={handleEnterChat}
                      />
                    } />
                    <Route path="/skills" element={<Navigate to="/settings" replace />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/employees" element={<EmployeesPage />} />
                    <Route path="/memory" element={<MemoryPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
            {chatMode && activeSession && (
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <ChatView
                    messages={activeSession.messages}
                    isProcessing={isActiveSessionProcessing}
                    attachedFiles={activeSession.attachedFiles}
                    sessionTitle={activeSession.title}
                    isDark={isDark}
                    onEditMessage={(msgId, newContent) => {
                      editMessage(activeSession.id, msgId, newContent);
                      handleSend(activeSession.id, newContent, activeSession.attachedFiles);
                    }}
                    onRegenerate={(msgId) => {
                      const idx = activeSession.messages.findIndex(m => m.id === msgId);
                      if (idx > 0) {
                        const prevUser = activeSession.messages.slice(0, idx).reverse().find(m => m.role === 'user');
                        if (prevUser) handleSend(activeSession.id, prevUser.content, activeSession.attachedFiles);
                      }
                    }}
                    onForkMessage={(msgId) => {
                      const forkedId = forkSession(activeSession.id, msgId);
                      if (forkedId) {
                        addToast('success', 'Forked to new session');
                      }
                    }}
                    onContinue={(msgId) => {
                      handleSend(activeSession.id, '请继续完成上述任务', activeSession.attachedFiles);
                    }}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          {/* Floating ChatPanel at the bottom of main content area */}
          <ChatPanel
            sessions={sessions}
            activeSession={activeSession}
            history={history}
            isSessionActive={isSessionActive}
            onCreateSession={handleCreateSession}
            onCloseSession={closeSession}
            onSwitchSession={(id) => {
              const targetSession = sessions.find(s => s.id === id);
              if (targetSession?.projectId) {
                setActiveProjectId(targetSession.projectId);
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
            isDark={isDark}
            activeProjectId={activeProjectId}
            projects={projects}
            onSwitchProject={(id) => setActiveProjectId(id)}
            onNewProject={handleOpenProjectActionModal}
            activeAgent={activeAgent}
            onAgentChange={setActiveAgent}
          />
        </div>

        {/* File Viewer — third column, right side */}
        <FileViewer isDark={isDark} />
      </div>

      {/* Mobile bottom nav */}
      <MobileNav activePage={activePage} onNavigate={handleNavigate} />

      {/* Project action modal */}
      {showProjectActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowProjectActionModal(false)}>
          <div className={`rounded-xl border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-sm shadow-2xl mx-4`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Project</h3>
            <div className="space-y-3">
              <button
                onClick={() => { setShowProjectActionModal(false); handleCreateNewProject(); }}
                className={`w-full rounded-lg border ${isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'} px-4 py-3 text-sm font-medium text-left transition-colors`}
              >
                <span className={`block text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>Create New Project</span>
                <span className={`block text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Start with an empty project</span>
              </button>
              <button
                onClick={() => { setShowProjectActionModal(false); handleImportProject(); }}
                className={`w-full rounded-lg border ${isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'} px-4 py-3 text-sm font-medium text-left transition-colors`}
              >
                <span className={`block text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>Import Existing Folder</span>
                <span className={`block text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Import a local folder as project</span>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowProjectActionModal(false)}
                className={`rounded px-3 py-1.5 text-sm border ${isDark ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ServerLoading>
  );
}
