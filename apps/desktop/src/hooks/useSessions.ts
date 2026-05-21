import { useState, useCallback, useEffect, useRef } from 'react';

export interface AttachedFile {
  id: string;
  name: string;
  path: string;
  type: 'local' | 'project';
}

import type { MeetingData } from '../components/MeetingCard';

export interface ToolCallStatus {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  args?: Record<string, unknown>;
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  isEdited?: boolean;
  meeting?: MeetingData;
  agentName?: string;
  thinking?: string;
  toolCalls?: ToolCallStatus[];
  usage?: { promptTokens: number; completionTokens: number; model: string };
}

export interface Session {
  id: string;
  title: string;
  projectId?: string;
  messages: ChatMessage[];
  attachedFiles: AttachedFile[];
  createdAt: Date;
  updatedAt: Date;
}

function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shortId(id: string): string {
  return id.slice(-6);
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem('cabinet-sessions');
    if (!raw) return [];
    const data = JSON.parse(raw);
    return data.map((s: any) => ({
      ...s,
      messages: s.messages?.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })) ?? [],
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem('cabinet-sessions', JSON.stringify(sessions));
}

function loadHistory(): Session[] {
  try {
    const raw = localStorage.getItem('cabinet-session-history');
    if (!raw) return [];
    const data = JSON.parse(raw);
    return data.map((s: any) => ({
      ...s,
      messages: s.messages?.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })) ?? [],
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveHistory(history: Session[]) {
  localStorage.setItem('cabinet-session-history', JSON.stringify(history));
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [history, setHistory] = useState<Session[]>(loadHistory);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const stored = sessions.length > 0 ? (sessions[0]?.id ?? null) : null;
    return stored;
  });
  const [activeSessionIds, setActiveSessionIds] = useState<Set<string>>(new Set());

  // Persist sessions — debounced to avoid serializing on every SSE chunk
  const sessionsSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(sessionsSaveTimer.current);
    sessionsSaveTimer.current = setTimeout(() => saveSessions(sessions), 500);
    return () => clearTimeout(sessionsSaveTimer.current);
  }, [sessions]);

  const historySaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(historySaveTimer.current);
    historySaveTimer.current = setTimeout(() => saveHistory(history), 500);
    return () => clearTimeout(historySaveTimer.current);
  }, [history]);

  const createSession = useCallback(
    (options?: { title?: string; initialContext?: string; attachedFiles?: AttachedFile[]; projectId?: string }): string => {
      const id = generateId();
      const session: Session = {
        id,
        title: options?.title ?? `Session-${shortId(id)}`,
        projectId: options?.projectId,
        messages: options?.initialContext
          ? [{ id: `sys_${Date.now()}`, role: 'user' as const, content: options.initialContext, timestamp: new Date() }]
          : [],
        attachedFiles: options?.attachedFiles ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(id);
      return id;
    },
    [],
  );

  const closeSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const session = prev.find((s) => s.id === id);
        if (session && session.messages.length > 0) {
          setHistory((hist) => [session, ...hist].slice(0, 50));
        }
        const remaining = prev.filter((s) => s.id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(remaining.length > 0 ? remaining[0]!.id : null);
        }
        return remaining;
      });
    },
    [activeSessionId],
  );

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const addMessage = useCallback((sessionId: string, msg: ChatMessage) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const existingIndex = s.messages.findIndex((m) => m.id === msg.id);
        let newMessages: ChatMessage[];
        if (msg.isStreaming && existingIndex >= 0) {
          newMessages = [...s.messages];
          newMessages[existingIndex] = msg;
        } else if (existingIndex >= 0) {
          newMessages = [...s.messages];
          newMessages[existingIndex] = msg;
        } else {
          newMessages = [...s.messages, msg];
        }
        // Update title to first user message
        const firstUserMsg = newMessages.find((m) => m.role === 'user');
        const title = firstUserMsg
          ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')
          : s.title;
        return { ...s, messages: newMessages, title, updatedAt: new Date() };
      }),
    );
  }, []);

  const addFile = useCallback((sessionId: string, file: AttachedFile) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, attachedFiles: [...s.attachedFiles, file] } : s,
      ),
    );
  }, []);

  const removeFile = useCallback((sessionId: string, fileId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, attachedFiles: s.attachedFiles.filter((f) => f.id !== fileId) }
          : s,
      ),
    );
  }, []);

  const setSessionActive = useCallback((id: string, active: boolean) => {
    setActiveSessionIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const reopenSession = useCallback((session: Session) => {
    setHistory((prev) => prev.filter((s) => s.id !== session.id));
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
  }, []);

  const deleteHistorySession = useCallback((id: string) => {
    setHistory((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const editMessage = useCallback(
    (sessionId: string, messageId: string, newContent: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === messageId ? { ...m, content: newContent, isEdited: true } : m,
                ),
              }
            : s,
        ),
      );
    },
    [],
  );

  const deleteMessagesFrom = useCallback((sessionId: string, messageId: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const idx = s.messages.findIndex((m) => m.id === messageId);
        if (idx === -1) return s;
        return { ...s, messages: s.messages.slice(0, idx) };
      }),
    );
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const isSessionActive = useCallback((id: string) => activeSessionIds.has(id), [activeSessionIds]);

  return {
    sessions,
    history,
    activeSessionId,
    activeSession,
    createSession,
    closeSession,
    switchSession,
    addMessage,
    addFile,
    removeFile,
    setSessionActive,
    reopenSession,
    deleteHistorySession,
    isSessionActive,
    editMessage,
    deleteMessagesFrom,
  };
}
