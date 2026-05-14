import { useState, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { TitleBar } from './components/TitleBar';
import { ChatPanel } from './components/ChatPanel';
import { ChatView } from './components/ChatView';
import { OfficePage } from './pages/OfficePage';
import { FactoryPage } from './pages/FactoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { MemoryPage } from './pages/MemoryPage';
import { useTheme } from './hooks/useTheme';
import { useSessions, type ChatMessage, type AttachedFile } from './hooks/useSessions';
import { useToast } from './components/Toast';
import { useProject } from './hooks/useProject';
import { MobileNav } from './components/MobileNav';

export function App() {
  const [activePage, setActivePage] = useState<NavPage>('office');
  const [chatMode, setChatMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const { addToast } = useToast();
  const { current } = useProject();

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

  const handleSend = useCallback(async (sessionId: string, message: string, files: AttachedFile[]) => {
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

    try {
      const res = await fetch('/api/secretary/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
        body: JSON.stringify({
          sessionId,
          message,
          projectId: current.id,
          files: files.map(f => ({ name: f.name, path: f.path, type: f.type })),
        }),
      });
      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: data.response ?? 'I received your message.',
        timestamp: new Date(),
      };
      addMessage(sessionId, assistantMsg);
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
  }, [current.id, addMessage, addToast, setSessionActive]);

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
                <Routes>
                  <Route path="/" element={<OfficePage />} />
                  <Route path="/office" element={<OfficePage />} />
                  <Route path="/factory" element={<FactoryPage />} />
                  <Route path="/skills" element={<SettingsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/employees" element={<EmployeesPage />} />
                  <Route path="/memory" element={<MemoryPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
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
