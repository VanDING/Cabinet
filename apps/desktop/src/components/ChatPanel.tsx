import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Plus, CheckCircle, Shield, Terminal, ArrowUp, Square } from 'lucide-react';
import type { Session, AttachedFile } from '../hooks/useSessions';
import { FileSearchPanel } from './FileSearchPanel';
import { SessionHistoryPanel } from './SessionHistoryPanel';
import { useSkills } from '../hooks/useSkills';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { ContextButton } from './ContextButton';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

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
}: Props) {
  const [input, setInput] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('cabinet-selected-model') ?? 'anthropic/claude-sonnet-4-6';
  });
  const [delegationTier, setDelegationTier] = useState<string>('T2');
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const tierBtnRef = useRef<HTMLButtonElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);

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
      .catch(() => {});
  }, []);
  const [isTauri, setIsTauri] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const skillBtnRef = useRef<HTMLButtonElement>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  const skills = useSkills();
  const availableModels = useAvailableModels();
  const active = activeSession;
  const attachedFiles = active?.attachedFiles ?? [];

  const borderClass = 'border-gray-200';
  const bgClass = 'bg-white';
  const tabBgClass = 'bg-gray-50';
  const inputBgClass = 'bg-white';
  const textClass = 'text-gray-800';
  const subtextClass = 'text-gray-500';
  const hoverClass = 'hover:bg-gray-100 hover:text-gray-700:bg-gray-700:text-gray-200';
  const btnBaseClass = 'text-gray-500';
  const dropdownBgClass = 'bg-white border-gray-200';
  const dropdownItemClass = 'text-gray-700 hover:bg-gray-100:bg-gray-700';

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI__' in window);
  }, []);

  useEffect(() => {
    localStorage.setItem('cabinet-selected-model', selectedModel);
  }, [selectedModel]);

  // Close menus on outside click
  useOutsideClick(tierBtnRef, () => setTierMenuOpen(false), tierMenuOpen);
  useOutsideClick(agentBtnRef, () => setAgentMenuOpen(false), agentMenuOpen);
  useOutsideClick(addBtnRef, () => setAddMenuOpen(false), addMenuOpen);
  useOutsideClick(skillBtnRef, () => setSkillMenuOpen(false), skillMenuOpen);
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
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    const sessionId = active ? active.id : onCreateSession();
    onSend(sessionId, trimmed, attachedFiles, undefined, selectedModel);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isProcessing, active, attachedFiles, onSend, onCreateSession]);

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

  const activeTabClass =
    'bg-white text-gray-800 border-blue-500';
  const inactiveTabClass =
    'text-gray-500 hover:bg-gray-200:bg-gray-700';

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10 flex justify-center">
      <div
        className={`rounded-2xl border shadow-2xl ${borderClass} ${bgClass} pointer-events-auto mb-4 w-full max-w-[1080px]`}
      >
        {/* Tab bar */}
        <div
          className={`flex h-8 items-center gap-1 rounded-t-2xl border-b px-2 ${borderClass} ${tabBgClass}`}
        >
          {/* Fixed @agent label */}
          <div className="relative flex-shrink-0">
            <button
              ref={agentBtnRef}
              onClick={() => setAgentMenuOpen(!agentMenuOpen)}
              className="flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-200:bg-blue-900/60"
              title="Switch agent"
            >
              @{activeAgent}
              <span className="text-[10px]">▼</span>
            </button>
            {agentMenuOpen && (
              <div
                className="absolute bottom-full left-0 z-50 mb-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
              >
                <div
                  className="border-b border-gray-200 px-3 py-1 text-xs text-gray-500"
                >
                  Switch Agent
                </div>
                {[
                  { id: 'secretary', name: 'Secretary' },
                  { id: 'meeting_chair', name: 'Meeting Chair' },
                  { id: 'organize', name: 'Organize' },
                ].map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      onAgentChange?.(a.id);
                      setAgentMenuOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                      activeAgent === a.id
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-600 hover:bg-gray-100:bg-gray-700'
                    }`}
                  >
                    @{a.id}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Project selector */}
          <div className="relative flex-shrink-0">
            <button
              ref={projectBtnRef}
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                activeProjectId
                  ? 'bg-green-100 text-green-700 hover:bg-green-200:bg-green-900/60'
                  : 'text-gray-500 hover:bg-gray-200:bg-gray-700'
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
                className={`absolute bottom-full left-0 z-50 mb-1 w-44 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>
                  Switch Project
                </div>
                <button
                  onClick={() => {
                    onSwitchProject?.(null);
                    setProjectMenuOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs ${!activeProjectId ? 'bg-blue-50 text-blue-600' : dropdownItemClass}`}
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
                        activeProjectId === p.id
                          ? 'bg-blue-50 text-blue-600'
                          : dropdownItemClass
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                <div className={`mt-1 border-t pt-1 ${borderClass}`}>
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
              .filter((s) => !activeProjectId || s.projectId === activeProjectId)
              .map((session) => {
                const isActive = session.id === active?.id;
                const hasActivity = isSessionActive(session.id);
                return (
                  <div
                    key={session.id}
                    onClick={() => onSwitchSession(session.id)}
                    className={`group flex min-w-[60px] max-w-[140px] flex-shrink cursor-pointer items-center gap-1 rounded border-b-2 px-2 py-0.5 text-xs transition-colors ${
                      isActive
                        ? activeTabClass + ' border-b-2'
                        : `${inactiveTabClass} border-b-2 border-transparent`
                    }`}
                  >
                    <span
                      className={`h-2 w-2 flex-shrink-0 rounded-full ${
                        hasActivity
                          ? 'animate-pulse bg-blue-500'
                          : `border border-gray-400`
                      }`}
                    />
                    <span className="flex-1 truncate">{session.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseSession(session.id);
                      }}
                      className="flex h-3 w-3 flex-shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            {activeProjectId &&
              sessions.filter((s) => s.projectId === activeProjectId).length === 0 && (
                <span className="px-2 text-[10px] text-gray-400">No sessions in this project</span>
              )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-0.5">
            <div className="relative">
              <button
                ref={historyBtnRef}
                onClick={() => setHistoryOpen(!historyOpen)}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${btnBaseClass} ${hoverClass}`}
                aria-label="Session history"
              >
                <Clock size={14} />
              </button>
              <SessionHistoryPanel
                isOpen={historyOpen}
                onClose={() => setHistoryOpen(false)}
                history={history}
                onReopen={(session) => {
                  onReopenSession(session);
                  setHistoryOpen(false);
                }}
                onDelete={(id) => onDeleteHistorySession(id)}
              />
            </div>

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
                className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
              >
                <span className="max-w-[160px] truncate" title={file.path}>
                  {file.type === 'project' ? file.path : file.name}
                </span>
                <button
                  onClick={() => {
                    if (active) onRemoveFile(active.id, file.id);
                  }}
                  className="text-blue-500 hover:text-red-500"
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            placeholder="Ask anything... (Enter to send, Shift+Enter for new line)"
            disabled={isProcessing}
            rows={2}
            className={`w-full resize-none border-0 bg-transparent text-sm placeholder-gray-400 focus:outline-none disabled:opacity-50 ${textClass}`}
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
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
                className={`absolute bottom-full left-0 z-50 mb-1 w-40 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
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
                className={`absolute bottom-full left-0 z-50 mb-1 max-h-48 w-48 overflow-y-auto rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>
                  Select a skill
                </div>
                {skills.length === 0 ? (
                  <div className="px-3 py-3 text-center text-xs text-gray-400">
                    No skills registered.
                  </div>
                ) : (
                  skills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => handleSelectSkill(skill.name)}
                      className={`w-full px-3 py-1.5 text-left font-mono text-xs ${dropdownItemClass}`}
                    >
                      <span className="mr-1.5 inline-block rounded bg-gray-200 px-1 py-0.5 text-gray-700">
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
                className={`absolute bottom-full right-0 z-50 mb-1 w-44 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>
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
                      }).catch(() => {});
                    }}
                    className={`w-full px-4 py-1.5 text-left transition-colors ${
                      delegationTier === t.id
                        ? 'bg-blue-50 text-blue-600'
                        : dropdownItemClass
                    }`}
                  >
                    <div className="text-xs font-medium">
                      {t.id} — {t.label}
                    </div>
                    <div className="text-[10px] text-gray-400">{t.desc}</div>
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
                className={`absolute bottom-full right-0 z-50 mb-1 max-h-64 w-56 overflow-y-auto rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
              >
                <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>
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
                            ? 'bg-blue-50 text-blue-600'
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
                ? 'bg-red-500 text-white hover:bg-red-600'
                : input.trim()
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'cursor-not-allowed bg-gray-300 text-gray-400'
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
