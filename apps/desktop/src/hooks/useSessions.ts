import { useState, useCallback, useEffect, useRef } from 'react';
import type { SubAgentActivity } from '@cabinet/ui';
import { apiFetch, authHeaders } from '../utils/api.js';
import type { AgentEvent } from '../types/agent-events';

export interface AttachedFile {
  id: string;
  name: string;
  path: string;
  type: 'local' | 'project';
}

export interface MeetingData {
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: Array<{ advisor: string; role: string; content: string }>;
}

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
  durationMs?: number;
  routing?: { from: string; to: string };
  isError?: boolean;
  thinkingDurationMs?: number;
  tasks?: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'done' | 'error';
    startTime?: number;
    endTime?: number;
  }>;
  semanticTasks?: Array<{
    id: string;
    title: string;
    status: 'pending' | 'running' | 'done' | 'error';
    steps?: number;
  }>;
  stepBudget?: { remaining: number; maxSteps: number };
  subAgentActivities?: SubAgentActivity[];
}

export interface Session {
  id: string;
  title: string;
  projectId?: string;
  messages: ChatMessage[];
  attachedFiles: AttachedFile[];
  createdAt: Date;
  updatedAt: Date;
  // Sub-agent tree support
  parentId?: string;
  agentType?: string;
  status?: 'active' | 'waiting_for_user' | 'completed' | 'error';
  events?: AgentEvent[];
  deliverable?: unknown;
}

/** Raw session data from localStorage/API (dates are strings). */
interface SessionJSON {
  id: string;
  title: string;
  projectId?: string;
  messages: Array<Omit<ChatMessage, 'timestamp'> & { timestamp: string }>;
  attachedFiles: AttachedFile[];
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  agentType?: string;
  status?: string;
  deliverable?: unknown;
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
    return data.map((s: SessionJSON) => ({
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
    return data.map((s: SessionJSON) => ({
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

  // Restore child sessions from server when active session changes
  const restoredParents = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeSessionId || restoredParents.current.has(activeSessionId)) return;
    restoredParents.current.add(activeSessionId);
    apiFetch(`/api/secretary/sessions/${activeSessionId}/children`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: { sessions: Session[] }) => {
        if (!data.sessions?.length) return;
        setSessions((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          const newChildren = data.sessions
            .filter((s) => !existingIds.has(s.id))
            .map((s) => ({
              ...s,
              messages: s.messages ?? [],
              attachedFiles: s.attachedFiles ?? [],
              createdAt: new Date(s.createdAt),
              updatedAt: new Date(s.updatedAt),
            }));
          return [...prev, ...newChildren];
        });
      })
      .catch(() => {
        /* best-effort restore */
      });
  }, [activeSessionId]);

  const historySaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(historySaveTimer.current);
    historySaveTimer.current = setTimeout(() => saveHistory(history), 500);
    return () => clearTimeout(historySaveTimer.current);
  }, [history]);

  const createSession = useCallback(
    (options?: {
      title?: string;
      initialContext?: string;
      attachedFiles?: AttachedFile[];
      projectId?: string;
    }): string => {
      const id = generateId();
      const session: Session = {
        id,
        title: options?.title ?? `Session-${shortId(id)}`,
        projectId: options?.projectId,
        messages: options?.initialContext
          ? [
              {
                id: `sys_${Date.now()}`,
                role: 'user' as const,
                content: options.initialContext,
                timestamp: new Date(),
              },
            ]
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
      // Notify backend to trigger Curator consolidation on session close
      apiFetch(`/api/secretary/sessions/${id}/close`, {
        method: 'POST',
        headers: authHeaders(),
      }).catch((err) => { console.warn('Operation failed', err); });
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

  const editMessage = useCallback((sessionId: string, messageId: string, newContent: string) => {
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
  }, []);

  /** Partially update an existing message — used for streaming increments to avoid full object replacement. */
  const updateMessage = useCallback(
    (sessionId: string, messageId: string, patch: Partial<Omit<ChatMessage, 'id'>>) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const idx = s.messages.findIndex((m) => m.id === messageId);
          if (idx === -1) return s;
          const existing = s.messages[idx]!;
          const nextMessages = [...s.messages];
          nextMessages[idx] = { ...existing, ...patch } as ChatMessage;
          return { ...s, messages: nextMessages, updatedAt: new Date() };
        }),
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

  /** Fork a new session from an existing one up to (and including) a message. */
  const forkSession = useCallback(
    (sessionId: string, messageId: string): string | null => {
      const source = sessions.find((s) => s.id === sessionId);
      if (!source) return null;
      const idx = source.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return null;

      const id = generateId();
      const forked: Session = {
        ...source,
        id,
        title: `${source.title} (fork)`,
        messages: source.messages.slice(0, idx + 1).map((m) => ({ ...m })),
        attachedFiles: [...source.attachedFiles],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setSessions((prev) => [forked, ...prev]);
      setActiveSessionId(id);
      return id;
    },
    [sessions],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const isSessionActive = useCallback((id: string) => activeSessionIds.has(id), [activeSessionIds]);

  // ── Sub-agent session helpers ──

  const createChildSession = useCallback(
    (parentId: string, agentType: string, title?: string): string => {
      const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const session: Session = {
        id,
        title: title ?? `${agentType} Agent`,
        parentId,
        agentType,
        status: 'active',
        messages: [],
        attachedFiles: [],
        events: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setSessions((prev) => [...prev, session]);
      return id;
    },
    [],
  );

  const getChildSessions = useCallback(
    (parentId: string) => sessions.filter((s) => s.parentId === parentId),
    [sessions],
  );

  const updateSubAgentEvents = useCallback((sessionId: string, event: AgentEvent) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, events: [...(s.events ?? []), event], updatedAt: new Date() }
          : s,
      ),
    );
  }, []);

  const updateSubAgentStatus = useCallback(
    (sessionId: string, status: Session['status']) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status, updatedAt: new Date() } : s)),
      );
    },
    [],
  );

  const setSubAgentDeliverable = useCallback(
    (sessionId: string, deliverable: unknown) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, deliverable, updatedAt: new Date() } : s,
        ),
      );
    },
    [],
  );

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
    updateMessage,
    deleteMessagesFrom,
    forkSession,
    createChildSession,
    getChildSessions,
    updateSubAgentEvents,
    updateSubAgentStatus,
    setSubAgentDeliverable,
  };
}
