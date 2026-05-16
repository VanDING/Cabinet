import { useState, useCallback, useEffect, lazy, Suspense, startTransition } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { TitleBar } from './components/TitleBar';
import { ChatPanel } from './components/ChatPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './hooks/useTheme';
import { useSessions, type ChatMessage, type AttachedFile } from './hooks/useSessions';
import { useToast } from './components/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import { MobileNav } from './components/MobileNav';
import { apiFetch, authJsonHeaders } from './utils/pin.js';
import { readSSEStream, formatPipelineResponse } from './utils/streaming.js';

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
const MeetingsPage = lazy(() =>
  import('./pages/MeetingsPage').then((m) => ({ default: m.MeetingsPage })),
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
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const { addToast } = useToast();

  // WebSocket for real-time events — batched as low-priority updates
  useWebSocket((type, data) => {
    window.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: data }));
    startTransition(() => {
      if (type === 'secretary_message') addToast('info', 'New message received');
      if (type === 'decision_created') addToast('info', `Decision "${data.title}" created`);
      if (type === 'decision_updated') addToast('info', `Decision ${data.status}`);
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
      setChatMode(false);
      navigate(`/${page === 'office' ? '' : page}`);
    },
    [navigate],
  );

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
    async (sessionId: string, message: string, files: AttachedFile[], dispatchMode?: string) => {
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

      const mode = dispatchMode ?? 'single';
      // Pipeline/parallel modes don't support streaming
      const useStream = mode === 'single';

      // Try SSE streaming first (single mode only)
      const streamId = `a_${Date.now()}`;
      try {
        const res = await apiFetch('/api/secretary/chat', {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            sessionId,
            message,
            stream: useStream,
            projectId: 'default',
            files: files.map((f) => ({ name: f.name, path: f.path, type: f.type })),
            dispatchMode: mode,
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
          });

          await readSSEStream(reader, {
            onContent(_, fullContent) {
              addMessage(sessionId, {
                id: streamId,
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
                isStreaming: true,
              });
            },
            onDone(fullContent) {
              addMessage(sessionId, {
                id: streamId,
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
                isStreaming: false,
              });
            },
            onError(error) {
              addMessage(sessionId, {
                id: streamId,
                role: 'assistant',
                content: `Error: ${error}`,
                timestamp: new Date(),
                isStreaming: false,
              });
            },
          });
        } else {
          // Fallback to JSON (or pipeline/parallel response)
          const data = await res.json();
          const content =
            data.dispatchMode === 'pipeline' || data.dispatchMode === 'parallel'
              ? formatPipelineResponse(data)
              : (data.response ?? 'I received your message.');

          addMessage(sessionId, {
            id: streamId,
            role: 'assistant',
            content,
            timestamp: new Date(),
          });
        }
      } catch {
        addToast('error', 'Failed to send message. Server may be offline.');
        addMessage(sessionId, {
          id: `e_${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I could not connect to the server.',
          timestamp: new Date(),
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
          />
        </div>

        {/* Main content area + ChatPanel column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Content: browse pages or chat view */}
          <div className="flex-1 overflow-hidden">
            {chatMode && activeSession ? (
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
            ) : (
              <div className="h-full overflow-auto">
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<OfficePage />} />
                      <Route path="/office" element={<OfficePage />} />
                      <Route path="/factory" element={<FactoryPage />} />
                      <Route path="/skills" element={<Navigate to="/settings" replace />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/employees" element={<EmployeesPage />} />
                      <Route path="/memory" element={<MemoryPage />} />
                      <Route path="/meetings" element={<MeetingsPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </div>
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
          />
        </div>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav activePage={activePage} onNavigate={handleNavigate} />
    </div>
  );
}
