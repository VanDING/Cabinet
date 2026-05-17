import { useState, useCallback, useEffect, lazy, Suspense, startTransition } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { TitleBar } from './components/TitleBar';
import { ChatPanel } from './components/ChatPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './hooks/useTheme';
import { useSessions, type ChatMessage, type AttachedFile } from './hooks/useSessions';
import { useToast } from './components/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import { MobileNav } from './components/MobileNav';
import { apiFetch, authJsonHeaders, authHeaders } from './utils/pin.js';
import type { MeetingData } from './components/MeetingCard';
import { readSSEStream } from './utils/streaming.js';
import { ProjectExplorer } from './components/ProjectExplorer';

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const { addToast } = useToast();

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
  useWebSocket((type, data) => {
    window.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: data }));
    startTransition(() => {
      if (type === 'secretary_message') addToast('info', 'New message received');
      if (type === 'decision_created') addToast('info', `Decision "${data.data?.title ?? 'Untitled'}" created`);
      if (type === 'decision_updated') addToast('info', `Decision ${data.data?.status ?? 'updated'}`);
    });
  });

  const {
    sessions,
    activeSession,
    history,
    isSessionActive,
    createSession,
    closeSession,
    switchSession,
    addMessage,
    addFile,
    removeFile,
    setSessionActive,
    reopenSession,
    deleteHistorySession,
  } = useSessions();

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

  const handleCreateProject = useCallback(async () => {
    let name = '';
    let rootPath = '';
    // Try folder picker first — folder name becomes project name
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: 'Select project folder', multiple: false });
      if (selected && typeof selected === 'string') {
        rootPath = selected;
        name = selected.split(/[/\\]/).pop() || selected;
      }
    } catch { /* Tauri dialog not available */ }
    // Fallback to manual name entry
    if (!name) {
      name = prompt('Project name:') || '';
    }
    if (!name.trim()) return;
    try {
      const r = await apiFetch('/api/projects', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: name.trim(), rootPath }),
      });
      if (r.ok) {
        refreshProjects();
        addToast('info', `Project "${name.trim()}" created`);
      }
    } catch {
      addToast('error', 'Failed to create project');
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
        addToast('info', `Project "${name}" deleted`);
      }
    } catch {
      addToast('error', 'Failed to delete project');
    }
  }, [refreshProjects, activeProjectId, addToast]);

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
    const id = createSession();
    setChatMode(true);
    return id;
  }, [createSession]);

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

  const handleSend = useCallback(
    async (sessionId: string, message: string, files: AttachedFile[], _dispatchMode?: string, model?: string) => {
      if (!message.trim() && files.length === 0) return;

      setChatMode(true);
      setSessionActive(sessionId, true);

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      addMessage(sessionId, userMsg);
      setIsProcessing(true);

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
            projectId: activeProjectId,
            files: files.map((f) => ({ name: f.name, path: f.path, type: f.type })),
            model,
          }),
        });

        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream') && res.body) {
          const reader = res.body.getReader();

          addMessage(sessionId, {
            id: streamId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
            agentName: 'Secretary',
          });

          let meetingData: MeetingData | undefined;

          await readSSEStream(reader, {
            onContent(_, fullContent) {
              addMessage(sessionId, {
                id: streamId,
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
                isStreaming: true,
                agentName: 'Secretary',
              });
            },
            onDone(fullContent, event) {
              if (event?.meeting) meetingData = event.meeting as MeetingData;
              addMessage(sessionId, {
                id: streamId,
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
                isStreaming: false,
                meeting: meetingData,
                agentName: (event as any)?.agentName ?? 'Secretary',
              });
            },
            onError(error) {
              addMessage(sessionId, {
                id: streamId,
                role: 'assistant',
                content: `Error: ${error}`,
                timestamp: new Date(),
                isStreaming: false,
                agentName: 'Secretary',
              });
            },
          });
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
            agentName: data.agentName ?? 'Secretary',
          });
        }
      } catch {
        addToast('error', 'Failed to send message. Server may be offline.');
        addMessage(sessionId, {
          id: `e_${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I could not connect to the server.',
          timestamp: new Date(),
          agentName: 'Secretary',
        });
      } finally {
        setIsProcessing(false);
        setSessionActive(sessionId, false);
      }
    },
    [addMessage, addToast, setSessionActive, setIsProcessing, setChatMode],
  );

  return (
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
            onNewProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
          />
        </div>

        {/* Project Explorer */}
        <ProjectExplorer
          projectId={activeProjectId}
          projectName={projects.find((p) => p.id === activeProjectId)?.name}
          isDark={isDark}
          onAddFile={addFile}
          activeSessionId={activeSession?.id}
        />

        {/* Main content area + ChatPanel column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
                    isProcessing={isProcessing}
                    attachedFiles={activeSession.attachedFiles}
                    sessionTitle={activeSession.title}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          {/* Persistent bottom ChatPanel — only in right content area */}
          <ChatPanel
            sessions={sessions}
            activeSession={activeSession}
            history={history}
            isSessionActive={isSessionActive}
            onCreateSession={handleCreateSession}
            onCloseSession={closeSession}
            onSwitchSession={(id) => {
              switchSession(id);
              setChatMode(true);
            }}
            onAddFile={addFile}
            onRemoveFile={removeFile}
            onReopenSession={reopenSession}
            onDeleteHistorySession={deleteHistorySession}
            onSend={handleSend}
            onEnterChat={handleEnterChat}
            isProcessing={isProcessing}
            isDark={isDark}
            activeProjectId={activeProjectId}
            projects={projects}
            onSwitchProject={(id) => setActiveProjectId(id)}
            onNewProject={handleCreateProject}
          />
        </div>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav activePage={activePage} onNavigate={handleNavigate} />
    </div>
  );
}
