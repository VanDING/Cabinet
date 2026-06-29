import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, CheckCircle, Shield, Terminal, ArrowUp, Square, ChevronDown, FileText, X } from 'lucide-react';
import type { Session, AttachedFile } from '../hooks/useSessions';
import type { InputTarget } from '../contexts/ChatContext';
import { FileSearchPanel } from './FileSearchPanel';
import { useSkills } from '../hooks/useSkills';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { ContextButton } from './ContextButton';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Attachment,
  AttachmentContent,
  AttachmentTitle,
  AttachmentActions,
  AttachmentAction,
  AttachmentMedia,
  AttachmentGroup,
} from '@/components/ui/attachment';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface ProjectInfo {
  id: string;
  name: string;
  lastActivityAt?: string;
  archived?: boolean;
}

interface Props {
  sessions: Session[];
  activeSession: Session | null;
  history: Session[];
  isSessionActive: (id: string) => boolean;
  onCreateSession: () => string;
  onCloseSession: (id: string) => void;
  onSwitchSession: (id: string) => void;
  onAddFile: (sessionId: string, file: AttachedFile) => void;
  onRemoveFile: (sessionId: string, fileId: string) => void;
  onReopenSession: (session: Session) => void;
  onDeleteHistorySession: (id: string) => void;
  onSend: (
    sessionId: string,
    message: string,
    files: AttachedFile[],
    dispatchMode?: string,
    model?: string,
  ) => void;
  onEnterChat: () => void;
  isProcessing: boolean;
  onStop?: (sessionId: string) => void;
  activeProjectId?: string | null;
  projects?: ProjectInfo[];
  onSwitchProject?: (projectId: string | null) => void;
  onNewProject?: () => void;
  activeAgent?: string;
  onAgentChange?: (agent: string) => void;
  inputTarget?: InputTarget;
  onInputTargetChange?: (target: InputTarget) => void;
  activeSessionId?: string | null;
  floating?: boolean;
  onMinimize?: () => void;
}

export function ChatPanel({
  sessions,
  activeSession,
  history,
  isSessionActive,
  onCreateSession,
  onCloseSession,
  onSwitchSession,
  onAddFile,
  onRemoveFile,
  onReopenSession,
  onDeleteHistorySession,
  onSend,
  onEnterChat,
  isProcessing,
  onStop,
  activeProjectId,
  projects = [],
  onSwitchProject,
  onNewProject,
  activeAgent = 'secretary',
  onAgentChange,
  inputTarget,
  onInputTargetChange,
  activeSessionId,
  floating = true,
  onMinimize,
}: Props) {
  const [input, setInput] = useState('');
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('cabinet-selected-model') ?? 'anthropic/claude-sonnet-4-6';
  });

  const [delegationTier, setDelegationTier] = useState<string>('T2');

  const TIERS = [
    { id: 'T0', label: 'Captain Review', desc: 'All writes blocked' },
    { id: 'T1', label: 'Strategic Guard', desc: 'Cost & destructive blocked' },
    { id: 'T2', label: 'Trusted Mode', desc: 'Most operations allowed' },
    { id: 'T3', label: 'Full Autonomy', desc: 'Budget cap only' },
  ] as const;

  useEffect(() => {
    apiFetch('/api/settings/delegation-tier', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.tier) setDelegationTier(d.tier);
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  }, []);
  const [isTauri, setIsTauri] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const skills = useSkills();
  const availableModels = useAvailableModels();
  const active = activeSession;
  const attachedFiles = active?.attachedFiles ?? [];

  useEffect(() => {
    if (availableModels.length === 0) return;
    const allModelIds = new Set(availableModels.flatMap((p) => p.models));
    if (!allModelIds.has(selectedModel)) {
      const first = availableModels[0]?.models[0];
      if (first) setSelectedModel(first);
    }
  }, [availableModels]);

  const borderClass = 'border-border';
  const bgClass = 'bg-surface-sidebar';
  const tabBgClass = 'bg-surface-elevated';
  const textClass = 'text-content-primary';

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI__' in window);
  }, []);

  useEffect(() => {
    localStorage.setItem('cabinet-selected-model', selectedModel);
  }, [selectedModel]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${newHeight}px`;
  }, [input]);

  // Listen for quick-suggestion clicks from ChatView
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail) {
        setInput(detail);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('quick-suggestion', handler);
    return () => window.removeEventListener('quick-suggestion', handler);
  }, []);

  const handleSend = useCallback(() => {
    let trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    const mentionMatch = trimmed.match(/^@(\w+)\s*/);
    if (mentionMatch) {
      trimmed = trimmed.slice(mentionMatch[0].length);
    }
    const sessionId = active ? active.id : onCreateSession();
    onSend(sessionId, trimmed, attachedFiles, undefined, selectedModel);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isProcessing, active, attachedFiles, onSend, onCreateSession, selectedModel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!input.trim() && !active) return;
        if (!active) onCreateSession();
        handleSend();
      }
    },
    [handleSend, active, input, onCreateSession],
  );

  const handleAddLocalFile = async () => {
    const sessionId = active ? active.id : onCreateSession();
    if (isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ multiple: false });
        if (selected) {
          const path = typeof selected === 'string' ? selected : selected;
          const name = (path as string).split(/[/\\]/).pop() ?? path;
          onAddFile(sessionId, {
            id: `f_${Date.now()}`,
            name: name as string,
            path: path as string,
            type: 'local',
          });
        }
      } catch {
        const name = `file-${Date.now()}.txt`;
        onAddFile(sessionId, { id: `f_${Date.now()}`, name, path: name, type: 'local' });
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = () => {
        const file = input.files?.[0];
        if (file)
          onAddFile(sessionId, {
            id: `f_${Date.now()}`,
            name: file.name,
            path: file.name,
            type: 'local',
          });
      };
      input.click();
    }
  };

  const handleAddProjectFile = () => {
    if (!active) onCreateSession();
    setFileSearchOpen(true);
  };

  const handleFileSelected = (file: { name: string; path: string }) => {
    const sessionId = active ? active.id : onCreateSession();
    onAddFile(sessionId, {
      id: `f_${Date.now()}`,
      name: file.name,
      path: file.path,
      type: 'project',
    });
  };

  const handleSelectSkill = (skill: string) => {
    setInput((prev) => {
      const before = prev.slice(0, textareaRef.current?.selectionStart ?? prev.length);
      const after = prev.slice(textareaRef.current?.selectionEnd ?? prev.length);
      return `${before}/${skill} ${after}`;
    });
    onEnterChat();
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleInputFocus = () => {
    if (!active) onCreateSession();
    onEnterChat();
  };

  const handleCreateSession = () => {
    onCreateSession();
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const activeTabClass = 'bg-surface-primary text-content-primary border-accent';
  const inactiveTabClass = 'text-content-tertiary hover:bg-surface-muted bg-surface-input';

  return (
    <div
      className={`pointer-events-none z-10 flex justify-center ${floating ? 'absolute right-4 bottom-4 left-4' : 'relative w-full'}`}
    >
      <div
        className={`chat-panel-inner rounded-2xl border shadow-2xl ${borderClass} ${bgClass} pointer-events-auto mb-4 w-full max-w-[1080px]`}
      >
        {/* Tab bar */}
        <div
          className={`flex h-8 items-center gap-1 rounded-t-2xl border-b px-2 ${borderClass} ${tabBgClass}`}
        >
          {/* Agent label */}
          <div className="shrink-0">
            <span className="bg-accent-muted text-accent flex items-center rounded-sm px-1.5 py-0.5 text-xs font-bold">
              @{activeAgent}
            </span>
          </div>

          {/* Project selector - DropdownMenu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                activeProjectId
                  ? 'bg-intent-success-muted text-intent-success'
                  : 'text-content-tertiary hover:bg-surface-muted bg-surface-input'
              }`}
              title="Select project"
            >
              @
              {activeProjectId
                ? (projects.find((p) => p.id === activeProjectId)?.name ?? 'Project')
                : 'no project'}
              <span className="text-[10px]">▼</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel className="text-xs">Switch Project</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSwitchProject?.(null)}>
                Global (no project)
              </DropdownMenuItem>
              {projects.filter((p) => !p.archived).map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => onSwitchProject?.(p.id)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onNewProject?.()}>
                + New Project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Session tabs */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {sessions
              .filter((s) => !s.parentId && (!activeProjectId || s.projectId === activeProjectId))
              .map((session) => {
                const isActive = session.id === active?.id;
                const hasActivity = isSessionActive(session.id);
                return (
                  <div
                    key={session.id}
                    onClick={() => onSwitchSession(session.id)}
                    className={`group flex max-w-[140px] min-w-[60px] flex-shrink cursor-pointer items-center gap-1 rounded border-b-2 px-2 py-0.5 text-xs transition-colors ${
                      isActive
                        ? activeTabClass + ' border-b-2'
                        : `${inactiveTabClass} border-b-2 border-transparent`
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        hasActivity ? 'bg-accent animate-pulse' : `border-border border`
                      }`}
                    />
                    <span className="flex-1 truncate">{session.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseSession(session.id);
                      }}
                      className="text-content-tertiary hover:text-intent-danger flex h-3 w-3 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            {activeProjectId &&
              sessions.filter((s) => !s.parentId && s.projectId === activeProjectId).length ===
                0 && (
                <span className="text-content-tertiary px-2 text-[10px]">
                  No sessions in this project
                </span>
              )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {onMinimize && (
              <button
                onClick={onMinimize}
                className="flex h-6 w-6 items-center justify-center rounded transition-colors text-content-tertiary hover:bg-surface-muted"
                title="Minimize"
                aria-label="Minimize"
              >
                <ChevronDown size={14} />
              </button>
            )}
            <button
              onClick={handleCreateSession}
              className="flex h-6 w-6 items-center justify-center rounded transition-colors text-content-tertiary hover:bg-surface-muted"
              aria-label="New session"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* File attachment area — AttachmentGroup */}
        {attachedFiles.length > 0 && (
          <div className={`border-b px-3 py-1.5 ${borderClass} ${tabBgClass}`}>
            <AttachmentGroup>
              {attachedFiles.map((file) => (
                <Attachment key={file.id} size="xs">
                  <AttachmentMedia><FileText className="h-3 w-3" /></AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle className="text-[10px]">
                      {file.type === 'project' ? file.path : file.name}
                    </AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${file.name}`}
                      onClick={() => { if (active) onRemoveFile(active.id, file.id); }}
                    >
                      <X className="h-3 w-3" />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          </div>
        )}

        {/* Input area */}
        <div className="px-3 pt-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              const mentionMatch = val.match(/^@(\w+)/);
              if (mentionMatch && activeSessionId) {
                onInputTargetChange?.({
                  type: 'subagent',
                  sessionId: activeSessionId,
                  agentId: mentionMatch[1]!,
                });
              }
            }}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            placeholder="Ask anything... (Enter to send, Shift+Enter for new line)"
            disabled={isProcessing}
            rows={2}
            className={`placeholder-content-tertiary w-full resize-none border-0 bg-transparent text-sm focus:outline-hidden disabled:opacity-50 ${textClass}`}
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
        </div>

        {/* Toolbar */}
        <div className="flex h-8 items-center gap-1 px-3 pb-2">
          {/* + Add button — DropdownMenu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors text-content-tertiary hover:bg-surface-muted"
            >
              <Plus size={14} />
              Add
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onSelect={handleAddLocalFile}>
                Local file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleAddProjectFile}>
                Project file
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* / Skills button — DropdownMenu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors text-content-tertiary hover:bg-surface-muted"
            >
              <CheckCircle size={14} />/ Skill
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 max-h-48 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Select a skill</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {skills.length === 0 ? (
                <DropdownMenuItem disabled>No skills registered.</DropdownMenuItem>
              ) : (
                skills.map((skill) => (
                  <DropdownMenuItem key={skill.id} onSelect={() => handleSelectSkill(skill.name)}
                    className="font-mono text-xs"
                  >
                    <span className="bg-surface-muted text-content-secondary mr-1.5 inline-block rounded-sm px-1 py-0.5">/</span>
                    {skill.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Delegation Tier selector — DropdownMenu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors text-content-tertiary hover:bg-surface-muted"
              title="Delegation tier"
            >
              <Shield size={14} />
              {delegationTier}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Delegation Tier</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {TIERS.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onSelect={() => {
                    setDelegationTier(t.id);
                    apiFetch('/api/settings/delegation-tier', {
                      method: 'PUT',
                      headers: authJsonHeaders(),
                      body: JSON.stringify({ tier: t.id }),
                    }).catch((err) => {
                      console.warn('Operation failed', err);
                    });
                  }}
                  className={delegationTier === t.id ? 'bg-accent-muted text-accent' : ''}
                >
                  <div>
                    <div className="text-xs font-medium">{t.id} — {t.label}</div>
                    <div className="text-content-tertiary text-[10px]">{t.desc}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Model switcher — DropdownMenu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors text-content-tertiary hover:bg-surface-muted"
              title="Switch model"
            >
              <Terminal size={14} />
              {selectedModel}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Select model</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableModels.map(({ provider, models }) => (
                <div key={provider}>
                  <div className="px-3 py-1 text-xs font-medium capitalize text-content-tertiary">
                    {provider}
                  </div>
                  {models.map((model) => (
                    <DropdownMenuItem
                      key={model}
                      onSelect={() => setSelectedModel(model)}
                      className={`font-mono text-xs ${
                        selectedModel === model ? 'bg-accent-muted text-accent' : ''
                      }`}
                    >
                      {model}
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Context status */}
          <ContextButton sessionId={active?.id ?? 'default'} />

          {/* Send / Stop button */}
          <button
            onClick={() => {
              if (isProcessing) {
                onStop?.(active?.id ?? 'default');
              } else {
                handleSend();
              }
            }}
            disabled={!isProcessing && !input.trim()}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              isProcessing
                ? 'bg-intent-danger text-content-inverse hover:bg-intent-danger'
                : input.trim()
                  ? 'bg-accent text-content-inverse hover:bg-accent-hover'
                  : 'bg-surface-muted text-content-tertiary cursor-not-allowed'
            }`}
            aria-label={isProcessing ? 'Stop' : 'Send'}
          >
            {isProcessing ? <Square size={14} /> : <ArrowUp size={16} />}
          </button>
        </div>

        {/* File search modal */}
        <FileSearchPanel
          isOpen={fileSearchOpen}
          onClose={() => setFileSearchOpen(false)}
          onSelect={handleFileSelected}
        />
      </div>
    </div>
  );
}
