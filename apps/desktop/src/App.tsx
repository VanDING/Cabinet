import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { TitleBar } from './components/TitleBar';
import { ChatPanel } from './components/ChatPanel';
import { ChatView } from './components/ChatView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsPage } from './pages/SettingsPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { MemoryPage } from './pages/MemoryPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { useTheme } from './hooks/useTheme';
import { useSessions, type ChatMessage, type AttachedFile } from './hooks/useSessions';
import { useToast } from './components/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import { MobileNav } from './components/MobileNav';
import { apiFetch, authJsonHeaders } from './utils/pin.js';

// Lazy-loaded heavy pages
const OfficePage = lazy(() => import('./pages/OfficePage').then(m => ({ default: m.OfficePage })));
const FactoryPage = lazy(() => import('./pages/FactoryPage').then(m => ({ default: m.FactoryPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center text-gray-400">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
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

  // WebSocket for real-time events
  useWebSocket((type, data) => {
    // Dispatch as window event so any page/component can listen
    window.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: data }));
    if (type === 'secretary_message') addToast('info', 'New message received');
    if (type === 'decision_created') addToast('info', `Decision "${data.title}" created`);
    if (type === 'decision_updated') addToast('info', `Decision ${data.status}`);
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

  const handleNavigate = useCallback((page: NavPage) => {
    setActivePage(page);
    setChatMode(false);
    navigate(`/${page === 'office' ? '' : page}`);
  }, [navigate]);

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
        if (e.key === 'b') { e.preventDefault(); setSidebarCollapsed(c => !c); }
        if (e.key === 'n') { e.preventDefault(); handleCreateSession(); }
        if (e.key === 'k') { e.preventDefault(); setActivePage('office'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateSession]);

  const handleSend = useCallback(async (sessionId: string, message: string, files: AttachedFile[], dispatchMode?: string) => {
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
          sessionId, message, stream: useStream,
          projectId: 'default',
          files: files.map(f => ({ name: f.name, path: f.path, type: f.type })),
          dispatchMode: mode,
        }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream') && res.body) {
        // SSE streaming
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        addMessage(sessionId, { id: streamId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true });

        let done = false;
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') { done = true; break; }
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) fullContent += parsed.content;
                else if (parsed.error) fullContent = `Error: ${parsed.error}`;
                addMessage(sessionId, { id: streamId, role: 'assistant', content: fullContent, timestamp: new Date(), isStreaming: true });
              } catch {}
            }
          }
        }
        addMessage(sessionId, { id: streamId, role: 'assistant', content: fullContent, timestamp: new Date(), isStreaming: false });
      } else {
        // Fallback to JSON (or pipeline/parallel response)
        const data = await res.json();
        let content = data.response ?? 'I received your message.';

        // Enrich pipeline/parallel responses with step info
        if (data.dispatchMode === 'pipeline' || data.dispatchMode === 'parallel') {
          const stepLines = (data.steps ?? []).map((s: any) =>
            `- **${s.role}**: ${s.status} (${s.durationMs}ms, ${s.agentSteps} steps)`
          );
          content = [
            `**Dispatch Mode:** ${data.dispatchMode}`,
            `**Total Steps:** ${data.totalSteps} | **Duration:** ${data.totalDurationMs}ms`,
            '',
            '### Pipeline Steps',
            ...stepLines,
            '',
            '### Result',
            content,
          ].join('\n');
        }

        addMessage(sessionId, {
          id: streamId, role: 'assistant',
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
  }, ['default', addMessage, addToast, setSessionActive]);

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${isDark ? 'dark' : ''}`}>
      {/* Custom Title Bar */}
      <TitleBar isDark={isDark} onToggleTheme={toggle} />

      {/* Main body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="hidden md:block h-full">
          <Navigation
            activePage={activePage}
            onNavigate={handleNavigate}
            isDark={isDark}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(c => !c)}
            onNavigateToSession={(sessionId) => {
              switchSession(sessionId);
              setChatMode(true);
            }}
          />
        </div>

        {/* Main content area + ChatPanel column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Content: browse pages or chat view */}
          <div className="flex-1 overflow-hidden">
            {chatMode && activeSession ? (
              <ChatView
                messages={activeSession.messages}
                isProcessing={isProcessing}
                attachedFiles={activeSession.attachedFiles}
                sessionTitle={activeSession.title}
              />
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
            onSwitchSession={id => { switchSession(id); setChatMode(true); }}
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
