import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from 'react';
import {
  useSessions,
  type ChatMessage,
  type AttachedFile,
  type Session,
} from '../hooks/useSessions';
import type { AgentInfo } from '../hooks/useAgents.js';

import { useProject } from './ProjectContext';

import { readSSEStream } from '../utils/streaming.js';

import { apiFetch, authJsonHeaders, authHeaders } from '../utils/api.js';

import type { MeetingData } from '../hooks/useSessions';

import type { SubAgentActivity } from '@cabinet/ui';

import type { AgentEvent } from '../types/agent-events';


import { toast } from 'sonner';export type InputTarget =
  | { type: 'secretary'; sessionId: string }
  | { type: 'subagent'; sessionId: string; agentId: string };

export type UIMode = 'idle' | 'browse' | 'chat';

export type OrbMood = 'idle' | 'thinking' | 'happy' | 'surprised' | 'sleepy';

export interface SecretaryNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'interactive';
  title: string;
  body?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
  }>;
  timestamp: number;
  autoDismiss?: number;
  mood?: OrbMood;
}

interface ChatContextValue {
  sessions: Session[];
  activeSession: Session | null;
  history: Session[];
  processingSessions: Set<string>;
  uiMode: UIMode;
  setUIMode: (mode: UIMode) => void;
  activeAgent: string;
  setActiveAgent: (v: string) => void;
  agents: AgentInfo[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  isSessionActive: (id: string) => boolean;
  inputTarget: InputTarget;
  setInputTarget: (target: InputTarget) => void;
  handleSend: (
    sessionId: string,
    message: string,
    files: AttachedFile[],
    dispatchMode?: string,
    model?: string,
  ) => Promise<void>;
  handleCreateSession: () => string;
  handleStop: (sessionId: string) => void;
  handleEnterChat: () => void;
  // Passthrough from useSessions for child components
  createSession: (options?: {
    title?: string;
    initialContext?: string;
    attachedFiles?: AttachedFile[];
    projectId?: string;
  }) => string;
  closeSession: (id: string) => void;
  switchSession: (id: string) => void;
  addFile: (sessionId: string, file: AttachedFile) => void;
  removeFile: (sessionId: string, fileId: string) => void;
  reopenSession: (session: Session) => void;
  deleteHistorySession: (id: string) => void;
  editMessage: (sessionId: string, messageId: string, newContent: string) => void;
  forkSession: (sessionId: string, messageId: string) => string | null;
  createChildSession: (parentId: string, agentType: string, title?: string) => string;
  getChildSessions: (parentId: string) => Session[];
  updateSubAgentEvents: (
    sessionId: string,
    event: import('../types/agent-events').AgentEvent,
  ) => void;
  updateSubAgentStatus: (sessionId: string, status: Session['status']) => void;
  setSubAgentDeliverable: (sessionId: string, deliverable: unknown) => void;
  notifications: SecretaryNotification[];
  sendNotification: (notification: Omit<SecretaryNotification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;
  orbMood: OrbMood;
  setOrbMood: (mood: OrbMood) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const {
    sessions,
    setSessions,
    activeSession,
    history,
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
    createChildSession,
    getChildSessions,
    updateSubAgentEvents,
    updateSubAgentStatus,
    setSubAgentDeliverable,
  } = useSessions();
  const { activeProjectId } = useProject();

  const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());
  const [uiMode, setUIMode] = useState<UIMode>(() => {
    try {
      const saved = localStorage.getItem('cabinet-ui-mode');
      if (saved === 'chat') return 'chat';
      if (saved === 'work' || saved === 'collapsed' || saved === 'overlay') return 'browse';
    } catch {
      /* JSON parse error */
    }
    return 'idle';
  });
  const [activeAgent, setActiveAgentRaw] = useState('secretary');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<SecretaryNotification[]>([]);
  const [orbMood, setOrbMood] = useState<OrbMood>('idle');

  // Fetch agents on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/employees', { headers: authHeaders() });
        const data = await res.json();
        if (!cancelled) {
          const all = data.employees ?? [];
          setAgents(all.filter((e: { kind: string }) => e.kind === 'ai'));
        }
      } catch {
        if (!cancelled) setAgents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wrap setActiveAgent to stamp agentId on current session
  const setActiveAgent = useCallback(
    (agentId: string) => {
      setActiveAgentRaw(agentId);
      setSessions((prev) => prev.map((s) => (s.id === activeSession?.id ? { ...s, agentId } : s)));
    },
    [activeSession, setSessions],
  );

  // Persist uiMode
  useEffect(() => {
    localStorage.setItem('cabinet-ui-mode', uiMode);
  }, [uiMode]);

  // Reset to work if chat is active but no session exists
  useEffect(() => {
    if (uiMode === 'chat' && !activeSession) {
      setUIMode('browse');
    }
  }, [uiMode, activeSession]);

  // Auto mood: thinking when processing, sleepy at night
  useEffect(() => {
    if (processingSessions.size > 0) {
      setOrbMood('thinking');
      return;
    }
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 7) {
      setOrbMood('sleepy');
    } else {
      setOrbMood('idle');
    }
  }, [processingSessions.size]);
  const [inputTarget, setInputTarget] = useState<InputTarget>(() =>
    activeSession
      ? { type: 'secretary', sessionId: activeSession.id }
      : { type: 'secretary', sessionId: 'default' },
  );
  const abortRef = useRef<Map<string, AbortController>>(new Map());

  // Keep inputTarget in sync when active session changes
  useEffect(() => {
    if (activeSession && inputTarget.type === 'secretary') {
      setInputTarget({ type: 'secretary', sessionId: activeSession.id });
    }
  }, [activeSession?.id]);

  const isSessionActive = useCallback(
    (id: string) => processingSessions.has(id),
    [processingSessions],
  );

  const handleCreateSession = useCallback((): string => {
    const id = createSession({ projectId: activeProjectId ?? undefined, agentId: activeAgent });
    setUIMode('chat');
    return id;
  }, [createSession, activeProjectId, activeAgent]);

  const handleStop = useCallback((sessionId: string) => {
    abortRef.current.get(sessionId)?.abort();
    abortRef.current.delete(sessionId);
  }, []);

  const handleEnterChat = useCallback(() => {
    setUIMode('chat');
  }, []);

  const sendNotification = useCallback(
    (notification: Omit<SecretaryNotification, 'id' | 'timestamp'>) => {
      const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const n: SecretaryNotification = {
        ...notification,
        id,
        timestamp: Date.now(),
        autoDismiss: notification.autoDismiss ?? 6000,
      };
      setNotifications((prev) => [...prev.slice(-2), n]);
      if (notification.mood) {
        setOrbMood(notification.mood);
        setTimeout(() => {
          setOrbMood((prev) => (prev === notification.mood ? 'idle' : prev));
        }, 3000);
      }
    },
    [],
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleSend = useCallback(
    async (
      sessionId: string,
      message: string,
      files: AttachedFile[],
      _dispatchMode?: string,
      model?: string,
    ) => {
      if (!message.trim() && files.length === 0) return;

      // ── Sub-agent mid-flight input routing ──
      if (inputTarget.type === 'subagent') {
        const userMsg: ChatMessage = {
          id: `subuser_${Date.now()}`,
          role: 'user',
          content: `[to ${inputTarget.agentId}] ${message}`,
          timestamp: new Date(),
        };
        addMessage(sessionId, userMsg);
        try {
          setSessionActive(sessionId, true);
          await apiFetch('/api/secretary/subagent/input', {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
              subAgentSessionId: inputTarget.sessionId,
              input: message,
            }),
          });
        } catch {
          toast.error('Failed to send input to sub-agent.');
        } finally {
          setSessionActive(sessionId, false);
        }
        return;
      }

      // Abort any in-flight request for THIS session before starting a new one
      abortRef.current.get(sessionId)?.abort();
      const controller = new AbortController();
      abortRef.current.set(sessionId, controller);

      setUIMode('chat');
      setSessionActive(sessionId, true);

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      addMessage(sessionId, userMsg);
      setProcessingSessions((prev) => new Set(prev).add(sessionId));

      // Always use streaming for responsive chat
      const streamId = `a_${Date.now()}`;
      try {
        // Detect skill invocation for structured payload
        const skillInvokeMatch = message.trim().match(/^\/(\S+)/);
        const isSkillInvoke = !!skillInvokeMatch;
        const skillName = isSkillInvoke ? skillInvokeMatch[1] : undefined;
        const skillArgs = isSkillInvoke
          ? message.trim().slice(skillInvokeMatch[0].length).trim()
          : undefined;

        const res = await apiFetch('/api/secretary/chat', {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            sessionId,
            message,
            stream: true,
            ...((activeSession?.projectId ?? activeProjectId)
              ? { projectId: activeSession?.projectId ?? activeProjectId }
              : {}),
            files: files.map((f) => ({ name: f.name, path: f.path, type: f.type })),
            ...(model ? { model } : {}),
            ...(activeAgent !== 'secretary' ? { targetAgent: activeAgent } : {}),
            ...(isSkillInvoke ? { type: 'skill_invoke', skillName, skillArgs } : {}),
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
          const structuredAccum: import('@cabinet/types').StructuredOutput[] = [];

          const subAgentMap = new Map<string, SubAgentActivity>();
          const flushSubAgents = () => {
            updateMessage(sessionId, streamId, {
              subAgentActivities: Array.from(subAgentMap.values()),
            });
          };

          const AGENT_DISPLAY: Record<string, string> = {
            secretary: 'Secretary',
            meeting_chair: 'Meeting Chair',
            organize: 'Organize',
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

          await readSSEStream(
            reader,
            {
              onRoutingStart(targetAgent) {
                const sourceDisplay = AGENT_DISPLAY[streamAgent] || streamAgent;
                const targetDisplay = AGENT_DISPLAY[targetAgent] || targetAgent;
                streamAgent = targetAgent;
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
                  const idx = toolCallsAccumulated
                    .map((tc) => tc.name === toolName && tc.status === 'running')
                    .lastIndexOf(true);
                  if (idx >= 0) {
                    toolCallsAccumulated = toolCallsAccumulated.map((tc, i) =>
                      i === idx
                        ? {
                            ...tc,
                            status: 'completed' as const,
                            result:
                              typeof detail?.result === 'string'
                                ? detail.result
                                : JSON.stringify(detail?.result),
                          }
                        : tc,
                    );
                  } else {
                    toolCallsAccumulated = [
                      ...toolCallsAccumulated,
                      {
                        id: `${toolName}_${Date.now()}`,
                        name: toolName,
                        status: 'completed' as const,
                        args: detail?.args as Record<string, unknown> | undefined,
                        result:
                          typeof detail?.result === 'string'
                            ? detail.result
                            : JSON.stringify(detail?.result),
                      },
                    ];
                  }
                } else if (type === 'error') {
                  const idx = toolCallsAccumulated
                    .map((tc) => tc.name === toolName && tc.status === 'running')
                    .lastIndexOf(true);
                  if (idx >= 0) {
                    toolCallsAccumulated = toolCallsAccumulated.map((tc, i) =>
                      i === idx ? { ...tc, status: 'error' as const } : tc,
                    );
                  }
                } else if (type === 'call_delta') {
                  const idx = toolCallsAccumulated
                    .map((tc) => tc.name === toolName && tc.status === 'running')
                    .lastIndexOf(true);
                  if (idx >= 0) {
                    toolCallsAccumulated = toolCallsAccumulated.map((tc, i) =>
                      i === idx
                        ? {
                            ...tc,
                            args: {
                              ...tc.args,
                              ...((detail?.args as Record<string, unknown>) ?? {}),
                            },
                          }
                        : tc,
                    );
                  }
                } else {
                  toolCallsAccumulated = [
                    ...toolCallsAccumulated,
                    {
                      id: `${toolName}_${Date.now()}`,
                      name: toolName,
                      status: 'running' as const,
                      args: detail?.args as Record<string, unknown> | undefined,
                    },
                  ];
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
              onStructuredOutput(output) {
                const so: import('@cabinet/types').StructuredOutput = {
                  id: output.id,
                  type: output.type as import('@cabinet/types').StructuredOutputType,
                  data: output.data,
                  status: 'proposed',
                  timestamp: output.timestamp,
                };
                structuredAccum.push(so);
                updateMessage(sessionId, streamId, {
                  structuredOutputs: [...structuredAccum],
                });
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
                  structuredOutputs: structuredAccum.length > 0 ? [...structuredAccum] : undefined,
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
              onUsage(usage) {
                updateMessage(sessionId, streamId, {
                  usage: { ...usage, model: streamAgent },
                });
              },
              onStopped() {
                flushSubAgents();
                subAgentMap.clear();
                const finalContent = lastContent || thinkingAccumulated || '';
                updateMessage(sessionId, streamId, {
                  isStreaming: false,
                  content: finalContent,
                  toolCalls: toolCallsAccumulated.length > 0 ? toolCallsAccumulated : undefined,
                  thinking: thinkingAccumulated || undefined,
                  durationMs: Date.now() - streamStart,
                });
              },
              onRouting(targetAgent) {
                streamAgent = targetAgent;
              },
            },
            controller.signal,
          );
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
        toast.error('Failed to send message. Server may be offline.');
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
        setProcessingSessions((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        setSessionActive(sessionId, false);
      }
    },
    [
      addMessage,
      setSessionActive,
      activeProjectId,
      activeAgent,
      activeSession,
      sessions,
      updateMessage,
      inputTarget,
    ],
  );

  const value = useMemo(
    () => ({
      sessions,
      activeSession,
      history,
      processingSessions,
      uiMode,
      setUIMode,
      activeAgent,
      setActiveAgent,
      agents,
      sidebarOpen,
      setSidebarOpen,
      inputTarget,
      setInputTarget,
      isSessionActive,
      handleSend,
      handleCreateSession,
      handleStop,
      handleEnterChat,
      createSession,
      closeSession,
      switchSession,
      addFile,
      removeFile,
      reopenSession,
      deleteHistorySession,
      editMessage,
      forkSession,
      createChildSession,
      getChildSessions,
      updateSubAgentEvents,
      updateSubAgentStatus,
      setSubAgentDeliverable,
      notifications,
      sendNotification,
      dismissNotification,
      orbMood,
      setOrbMood,
    }),
    [
      sessions,
      activeSession,
      history,
      processingSessions,
      uiMode,
      activeAgent,
      agents,
      sidebarOpen,
      inputTarget,
      isSessionActive,
      handleSend,
      handleCreateSession,
      handleStop,
      handleEnterChat,
      createSession,
      closeSession,
      switchSession,
      addFile,
      removeFile,
      reopenSession,
      deleteHistorySession,
      editMessage,
      forkSession,
      createChildSession,
      getChildSessions,
      updateSubAgentEvents,
      updateSubAgentStatus,
      setSubAgentDeliverable,
      notifications,
      sendNotification,
      dismissNotification,
      orbMood,
      setOrbMood,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
