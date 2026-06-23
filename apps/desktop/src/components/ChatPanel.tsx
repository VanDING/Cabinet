import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, CheckCircle, Shield, Terminal, ArrowUp, Square, ChevronDown } from 'lucide-react';
import type { Session, AttachedFile } from '../hooks/useSessions';
import type { InputTarget } from '../contexts/ChatContext';
import { FileSearchPanel } from './FileSearchPanel';
import { useSkills } from '../hooks/useSkills';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { ContextButton } from './ContextButton';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';

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
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('cabinet-selected-model') ?? 'anthropic/claude-sonnet-4-6';
  });

  const [delegationTier, setDelegationTier] = useState<string>('T2');
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const tierBtnRef = useRef<HTMLButtonElement>(null);

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
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const skillBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

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
  const inputBgClass = 'bg-surface-primary';
  const textClass = 'text-content-primary';
  const subtextClass = 'text-content-tertiary';
  const hoverClass =
    'hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary';
  const btnBaseClass = 'text-content-tertiary';
  const dropdownBgClass = 'bg-surface-2 border-border';
  const dropdownItemClass = 'text-content-secondary hover:bg-surface-muted bg-surface-input';

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI__' in window);
  }, []);

  useEffect(() => {
    localStorage.setItem('cabinet-selected-model', selectedModel);
  }, [selectedModel]);

  // Close menus on outside click
  useOutsideClick(tierBtnRef, () => setTierMenuOpen(false), tierMenuOpen);
  useOutsideClick(addBtnRef, () => setAddMenuOpen(false), addMenuOpen);
  useOutsideClick(skillBtnRef, () => setSkillMenuOpen(false), skillMenuOpen);
  useOutsideClick(slashMenuRef, () => setSlashMenuOpen(false), slashMenuOpen);
  useOutsideClick(modelBtnRef, () => setModelMenuOpen(false), modelMenuOpen);
  useOutsideClick(projectBtnRef, () => setProjectMenuOpen(false), projectMenuOpen);

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
    // Strip @mention prefix if present
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
    setAddMenuOpen(false);
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
    setAddMenuOpen(false);
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
    setSkillMenuOpen(false);
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
          {/* Agent label (selection via AgentTopBar) */}
          <div className="shrink-0">
            <span className="bg-accent-muted text-accent flex items-center rounded-sm px-1.5 py-0.5 text-xs font-bold">
              @{activeAgent}
            </span>
          </div>
          {/* Project selector */}
          <div className="relative shrink-0">
            <button
              ref={projectBtnRef}
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                activeProjectId
                  ? 'bg-intent-success-muted text-intent-success hover:bg-intent-success-muted:bg-intent-success/60'
                  : 'text-content-tertiary hover:bg-surface-muted bg-surface-input'
              }`}
              title="Select project"
            >
              @
              {activeProjectId
                ? (projects.find((p) => p.id === activeProjectId)?.name ?? 'Project')
                : 'no project'}
              <span className="text-[10px]">▼</span>
            </button>
            {projectMenuOpen && (
              <div
                className={`dropdown-enter border-border absolute bottom-full left-0 z-50 mb-1 w-44 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-hairline border-b`}>
                  Switch Project
                </div>
                <button
                  onClick={() => {
                    onSwitchProject?.(null);
                    setProjectMenuOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs ${!activeProjectId ? 'bg-accent-muted text-accent' : dropdownItemClass}`}
                >
                  Global (no project)
                </button>
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onSwitchProject?.(p.id);
                        setProjectMenuOpen(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs ${
                        activeProjectId === p.id ? 'bg-accent-muted text-accent' : dropdownItemClass
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                <div className={`border-hairline mt-1 border-t pt-1`}>
                  <button
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onNewProject?.();
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs ${dropdownItemClass}`}
                  >
                    + New Project
                  </button>
                </div>
              </div>
            )}
          </div>
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
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${btnBaseClass} ${hoverClass}`}
                title="Minimize"
                aria-label="Minimize"
              >
                <ChevronDown size={14} />
              </button>
            )}

            <button
              onClick={handleCreateSession}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${btnBaseClass} ${hoverClass}`}
              aria-label="New session"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* File attachment area */}
        {attachedFiles.length > 0 && (
          <div
            className={`flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5 ${borderClass} ${tabBgClass}`}
          >
            {attachedFiles.map((file) => (
              <span
                key={file.id}
                className="bg-accent-muted text-accent inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs"
              >
                <span className="max-w-[160px] truncate" title={file.path}>
                  {file.type === 'project' ? file.path : file.name}
                </span>
                <button
                  onClick={() => {
                    if (active) onRemoveFile(active.id, file.id);
                  }}
                  className="text-accent hover:text-intent-danger"
                >
                  &times;
                </button>
              </span>
            ))}
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
              // @mention detection
              const mentionMatch = val.match(/^@(\w+)/);
              if (mentionMatch && activeSessionId) {
                onInputTargetChange?.({
                  type: 'subagent',
                  sessionId: activeSessionId,
                  agentId: mentionMatch[1]!,
                });
              }
              // /skill detection
              const slashMatch = val.match(/^\/(\S*)/);
              if (slashMatch) {
                setSlashMenuOpen(true);
              } else {
                setSlashMenuOpen(false);
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
          {slashMenuOpen && (
            <div
              ref={slashMenuRef}
              className={`dropdown-enter border-border absolute bottom-full left-3 z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
            >
              <div className={`px-3 py-1 text-xs ${subtextClass} border-hairline border-b`}>
                Select a skill
              </div>
              {skills.length === 0 ? (
                <div className="text-content-tertiary px-3 py-3 text-center text-xs">
                  No skills registered.
                </div>
              ) : (
                skills.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => {
                      setInput(`/${skill.name} `);
                      setSlashMenuOpen(false);
                      setTimeout(() => textareaRef.current?.focus(), 50);
                    }}
                    className={`w-full px-3 py-1.5 text-left font-mono text-xs ${dropdownItemClass}`}
                  >
                    <span className="bg-surface-muted text-content-secondary mr-1.5 inline-block rounded-sm px-1 py-0.5">
                      /
                    </span>
                    {skill.name}
                    {skill.description && (
                      <span className="text-content-tertiary ml-2">— {skill.description}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex h-8 items-center gap-1 px-3 pb-2">
          {/* + Add button */}
          <div className="relative">
            <button
              ref={addBtnRef}
              onClick={() => setAddMenuOpen(!addMenuOpen)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
            >
              <Plus size={14} />
              Add
            </button>
            {addMenuOpen && (
              <div
                className={`dropdown-enter border-border absolute bottom-full left-0 z-50 mb-1 w-40 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <button
                  onClick={handleAddLocalFile}
                  className={`w-full px-3 py-1.5 text-left text-xs ${dropdownItemClass}`}
                >
                  Local file
                </button>
                <button
                  onClick={handleAddProjectFile}
                  className={`w-full px-3 py-1.5 text-left text-xs ${dropdownItemClass}`}
                >
                  Project file
                </button>
              </div>
            )}
          </div>

          {/* / Skills button */}
          <div className="relative">
            <button
              ref={skillBtnRef}
              onClick={() => setSkillMenuOpen(!skillMenuOpen)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
            >
              <CheckCircle size={14} />/ Skill
            </button>
            {skillMenuOpen && (
              <div
                className={`dropdown-enter border-border absolute bottom-full left-0 z-50 mb-1 max-h-48 w-48 overflow-y-auto rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-hairline border-b`}>
                  Select a skill
                </div>
                {skills.length === 0 ? (
                  <div className="text-content-tertiary px-3 py-3 text-center text-xs">
                    No skills registered.
                  </div>
                ) : (
                  skills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => handleSelectSkill(skill.name)}
                      className={`w-full px-3 py-1.5 text-left font-mono text-xs ${dropdownItemClass}`}
                    >
                      <span className="bg-surface-muted text-content-secondary mr-1.5 inline-block rounded-sm px-1 py-0.5">
                        /
                      </span>
                      {skill.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Delegation Tier selector */}
          <div className="relative">
            <button
              ref={tierBtnRef}
              onClick={() => setTierMenuOpen(!tierMenuOpen)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
              title="Delegation tier"
            >
              <Shield size={14} />
              {delegationTier}
            </button>
            {tierMenuOpen && (
              <div
                className={`dropdown-enter border-border absolute right-0 bottom-full z-50 mb-1 w-44 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-hairline border-b`}>
                  Delegation Tier
                </div>
                {TIERS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setDelegationTier(t.id);
                      setTierMenuOpen(false);
                      apiFetch('/api/settings/delegation-tier', {
                        method: 'PUT',
                        headers: authJsonHeaders(),
                        body: JSON.stringify({ tier: t.id }),
                      }).catch((err) => {
                        console.warn('Operation failed', err);
                      });
                    }}
                    className={`w-full px-4 py-1.5 text-left transition-colors ${
                      delegationTier === t.id ? 'bg-accent-muted text-accent' : dropdownItemClass
                    }`}
                  >
                    <div className="text-xs font-medium">
                      {t.id} — {t.label}
                    </div>
                    <div className="text-content-tertiary text-[10px]">{t.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model switcher */}
          <div className="relative">
            <button
              ref={modelBtnRef}
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
              title="Switch model"
            >
              <Terminal size={14} />
              {selectedModel}
            </button>
            {modelMenuOpen && (
              <div
                className={`dropdown-enter border-border absolute right-0 bottom-full z-50 mb-1 max-h-64 w-56 overflow-y-auto rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-hairline border-b`}>
                  Select model
                </div>
                {availableModels.map(({ provider, models }) => (
                  <div key={provider}>
                    <div className={`px-3 py-1 text-xs font-medium capitalize ${subtextClass}`}>
                      {provider}
                    </div>
                    {models.map((model) => (
                      <button
                        key={model}
                        onClick={() => {
                          setSelectedModel(model);
                          setModelMenuOpen(false);
                        }}
                        className={`w-full px-5 py-1 text-left font-mono text-xs transition-colors ${
                          selectedModel === model
                            ? 'bg-accent-muted text-accent'
                            : dropdownItemClass
                        }`}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Context status */}
          <ContextButton
            sessionId={active?.id ?? 'default'}
            btnBaseClass={btnBaseClass}
            hoverClass={hoverClass}
            dropdownBgClass={dropdownBgClass}
          />

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
