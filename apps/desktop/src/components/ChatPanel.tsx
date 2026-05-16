import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session, AttachedFile } from '../hooks/useSessions';
import { FileSearchPanel } from './FileSearchPanel';
import { SessionHistoryPanel } from './SessionHistoryPanel';
import { apiFetch, authHeaders } from '../utils/pin.js';

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
  onSend: (sessionId: string, message: string, files: AttachedFile[], dispatchMode?: string) => void;
  onEnterChat: () => void;
  isProcessing: boolean;
  isDark?: boolean;
}

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  google: ['gemini-2.0-flash', 'gemini-2.0-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-r1'],
  qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4', 'glm-4-flash'],
  baichuan: ['baichuan4', 'baichuan3-turbo'],
  custom: ['custom-model'],
};

function useSkills(): string[] {
  const [skills, setSkills] = useState<string[]>([]);

  useEffect(() => {
    apiFetch('/api/skills', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.skills?.length > 0) {
          setSkills(d.skills.map((s: any) => s.name));
        }
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem('cabinet-skills');
          if (raw) setSkills(JSON.parse(raw).map((s: any) => s.name ?? s));
        } catch {}
      });
  }, []);

  return skills;
}

function useAvailableModels(): { provider: string; models: string[] }[] {
  const [available, setAvailable] = useState<{ provider: string; models: string[] }[]>([]);

  useEffect(() => {
    apiFetch('/api/settings/api-keys', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.keys?.length > 0) {
          const providers = [...new Set(d.keys.map((k: any) => k.provider))] as string[];
          setAvailable(
            providers.map(p => ({
              provider: p,
              models: PROVIDER_MODELS[p] ?? PROVIDER_MODELS.custom ?? [],
            }))
          );
        } else {
          // Fallback: show all models if no keys configured
          setAvailable(
            Object.entries(PROVIDER_MODELS).map(([provider, models]) => ({ provider, models }))
          );
        }
      })
      .catch(() => {
        setAvailable(
          Object.entries(PROVIDER_MODELS).map(([provider, models]) => ({ provider, models }))
        );
      });
  }, []);

  return available;
}

function ContextButton({ sessionId, isDark, btnBaseClass, hoverClass, dropdownBgClass }: {
  sessionId: string; isDark?: boolean; btnBaseClass: string; hoverClass: string; dropdownBgClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ messageCount?: number; estimatedTokens?: number; maxContextTokens?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const fetchContext = () => {
    setOpen(!open);
    if (!open) {
      apiFetch(`/api/secretary/context?sessionId=${sessionId}`, { headers: authHeaders() })
        .then(r => r.json())
        .then(setData)
        .catch(() => setData(null));
    }
  };

  const tokens = data?.estimatedTokens ?? 0;
  const max = data?.maxContextTokens ?? 200000;
  const pct = max > 0 ? Math.round((tokens / max) * 100) : 0;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={fetchContext}
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
        title="View context usage"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="1.5" y="2" width="9" height="8" rx="1" />
          <path d="M4 4.5h4M4 6.5h3M4 8.5h2" />
        </svg>
        Context: {data ? `${pct}%` : '--'}
      </button>
      {open && (
        <div className={`absolute bottom-full right-0 mb-1 w-56 border rounded-lg shadow-xl z-50 p-3 ${dropdownBgClass} text-xs`}>
          <div className="font-medium mb-2 text-gray-700 dark:text-gray-200">Context Usage</div>
          {data ? (
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Messages</span>
                <span className="text-gray-700 dark:text-gray-300 font-mono">{data.messageCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Est. Tokens</span>
                <span className="text-gray-700 dark:text-gray-300 font-mono">{tokens.toLocaleString()} / {max.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5 mt-1">
                <div className={`h-1.5 rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <p className="text-gray-400 italic text-xs mt-1">Auto-compact coming soon</p>
            </div>
          ) : (
            <p className="text-gray-400 italic">Loading...</p>
          )}
        </div>
      )}
    </div>
  );
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
  isDark,
}: Props) {
  const [input, setInput] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('cabinet-selected-model') ?? 'claude-sonnet-4-6';
  });
  const [dispatchMode, setDispatchMode] = useState<'single' | 'pipeline' | 'parallel'>(() => {
    return (localStorage.getItem('cabinet-dispatch-mode') as 'single' | 'pipeline' | 'parallel') ?? 'single';
  });
  const [dispatchMenuOpen, setDispatchMenuOpen] = useState(false);
  const dispatchBtnRef = useRef<HTMLButtonElement>(null);
  const [isTauri, setIsTauri] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const skillBtnRef = useRef<HTMLButtonElement>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  const skills = useSkills();
  const availableModels = useAvailableModels();
  const active = activeSession;
  const attachedFiles = active?.attachedFiles ?? [];

  const borderClass = isDark ? 'border-gray-700' : 'border-gray-200';
  const bgClass = isDark ? 'bg-gray-800' : 'bg-white';
  const tabBgClass = isDark ? 'bg-gray-900' : 'bg-gray-50';
  const inputBgClass = isDark ? 'bg-gray-800' : 'bg-white';
  const textClass = isDark ? 'text-gray-100' : 'text-gray-800';
  const subtextClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const hoverClass = isDark ? 'hover:bg-gray-700 hover:text-gray-200' : 'hover:bg-gray-100 hover:text-gray-700';
  const btnBaseClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const dropdownBgClass = isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200';
  const dropdownItemClass = isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100';

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI__' in window);
  }, []);

  useEffect(() => {
    localStorage.setItem('cabinet-selected-model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('cabinet-dispatch-mode', dispatchMode);
  }, [dispatchMode]);

  // Close dispatch menu on outside click
  useEffect(() => {
    if (!dispatchMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (dispatchBtnRef.current && !dispatchBtnRef.current.contains(e.target as Node)) setDispatchMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dispatchMenuOpen]);

  // Close menus on outside click
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!skillMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (skillBtnRef.current && !skillBtnRef.current.contains(e.target as Node)) setSkillMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [skillMenuOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelBtnRef.current && !modelBtnRef.current.contains(e.target as Node)) setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${newHeight}px`;
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    const sessionId = active ? active.id : onCreateSession();
    onSend(sessionId, trimmed, attachedFiles, dispatchMode);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isProcessing, active, attachedFiles, onSend, onCreateSession]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() && !active) return;
      if (!active) onCreateSession();
      handleSend();
    }
  }, [handleSend, active, input, onCreateSession]);

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
          onAddFile(sessionId, { id: `f_${Date.now()}`, name: name as string, path: path as string, type: 'local' });
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
        if (file) onAddFile(sessionId, { id: `f_${Date.now()}`, name: file.name, path: file.name, type: 'local' });
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
    onAddFile(sessionId, { id: `f_${Date.now()}`, name: file.name, path: file.path, type: 'project' });
  };

  const handleSelectSkill = (skill: string) => {
    setSkillMenuOpen(false);
    setInput(prev => {
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

  const activeTabClass = isDark
    ? 'bg-gray-800 text-gray-200 border-blue-500'
    : 'bg-white text-gray-800 border-blue-500';
  const inactiveTabClass = isDark
    ? 'text-gray-500 hover:bg-gray-700'
    : 'text-gray-500 hover:bg-gray-200';

  return (
    <div className={`border-t ${borderClass} ${bgClass} flex-shrink-0`}>
      {/* Tab bar */}
      <div className={`flex items-center h-8 px-2 gap-1 border-b ${borderClass} ${tabBgClass}`}>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {sessions.map(session => {
            const isActive = session.id === active?.id;
            const hasActivity = isSessionActive(session.id);
            return (
              <div
                key={session.id}
                onClick={() => onSwitchSession(session.id)}
                className={`group flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer flex-shrink min-w-[60px] max-w-[140px] transition-colors border-b-2 ${
                  isActive ? activeTabClass + ' border-b-2' : `${inactiveTabClass} border-b-2 border-transparent`
                }`}
              >
                <span className={`flex-shrink-0 w-2 h-2 rounded-full ${
                  hasActivity ? 'bg-blue-500 animate-pulse' : `border ${isDark ? 'border-gray-500' : 'border-gray-400'}`
                }`} />
                <span className="truncate flex-1">{session.title}</span>
                <button
                  onClick={e => { e.stopPropagation(); onCloseSession(session.id); }}
                  className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <div className="relative">
            <button
              ref={historyBtnRef}
              onClick={() => setHistoryOpen(!historyOpen)}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${btnBaseClass} ${hoverClass}`}
              aria-label="Session history"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="7" cy="7" r="5.5" />
                <path d="M7 4v3l2 2" />
              </svg>
            </button>
            <SessionHistoryPanel
              isOpen={historyOpen}
              onClose={() => setHistoryOpen(false)}
              history={history}
              onReopen={session => { onReopenSession(session); setHistoryOpen(false); }}
              onDelete={id => onDeleteHistorySession(id)}
            />
          </div>

          <button
            onClick={handleCreateSession}
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${btnBaseClass} ${hoverClass}`}
            aria-label="New session"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 3v8M3 7h8" />
            </svg>
          </button>
        </div>
      </div>

      {/* File attachment area */}
      {attachedFiles.length > 0 && (
        <div className={`flex items-center gap-1.5 px-3 py-1.5 flex-wrap border-b ${borderClass} ${tabBgClass}`}>
          {attachedFiles.map(file => (
            <span
              key={file.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs"
            >
              <span className="truncate max-w-[160px]" title={file.path}>
                {file.type === 'project' ? file.path : file.name}
              </span>
              <button
                onClick={() => { if (active) onRemoveFile(active.id, file.id); }}
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
          onChange={e => setInput(e.target.value)}
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
      <div className="flex items-center gap-1 px-3 pb-2 h-8">
        {/* + Add button */}
        <div className="relative">
          <button
            ref={addBtnRef}
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2v8M2 6h8" />
            </svg>
            Add
          </button>
          {addMenuOpen && (
            <div className={`absolute bottom-full left-0 mb-1 w-40 border rounded-lg shadow-xl z-50 py-1 ${dropdownBgClass}`}>
              <button onClick={handleAddLocalFile} className={`w-full text-left px-3 py-1.5 text-xs ${dropdownItemClass}`}>
                Local file
              </button>
              <button onClick={handleAddProjectFile} className={`w-full text-left px-3 py-1.5 text-xs ${dropdownItemClass}`}>
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
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6l1.5 1.5L8 4.5" />
              <circle cx="6" cy="6" r="5" />
            </svg>
            / Skill
          </button>
          {skillMenuOpen && (
            <div className={`absolute bottom-full left-0 mb-1 w-48 border rounded-lg shadow-xl z-50 py-1 max-h-48 overflow-y-auto ${dropdownBgClass}`}>
              <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>Select a skill</div>
              {skills.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-400 text-center">
                  No skills registered.
                </div>
              ) : (
                skills.map(skill => (
                  <button
                    key={skill}
                    onClick={() => handleSelectSkill(skill)}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono ${dropdownItemClass}`}
                  >
                    <span className="inline-block px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 mr-1.5">/</span>
                    {skill}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Dispatch mode selector */}
        <div className="relative">
          <button
            ref={dispatchBtnRef}
            onClick={() => setDispatchMenuOpen(!dispatchMenuOpen)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
            title="Agent dispatch mode"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M3 3h2v2H3zM7 3h2v2H7zM3 7h2v2H3zM7 7h2v2H7z" />
            </svg>
            {dispatchMode === 'single' ? 'Single' : dispatchMode === 'pipeline' ? 'Pipeline' : 'Parallel'}
          </button>
          {dispatchMenuOpen && (
            <div className={`absolute bottom-full right-0 mb-1 w-44 border rounded-lg shadow-xl z-50 py-1 ${dropdownBgClass}`}>
              <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>Dispatch Mode</div>
              {([
                { id: 'single', label: 'Single Agent', desc: 'One agent handles everything' },
                { id: 'pipeline', label: 'Pipeline', desc: 'Planner → Generator → Reviewer' },
                { id: 'parallel', label: 'Parallel', desc: 'Multiple agents concurrently' },
              ] as const).map(mode => (
                <button
                  key={mode.id}
                  onClick={() => { setDispatchMode(mode.id); setDispatchMenuOpen(false); }}
                  className={`w-full text-left px-4 py-1.5 transition-colors ${
                    dispatchMode === mode.id
                      ? (isDark ? 'text-blue-400 bg-blue-900/30' : 'text-blue-600 bg-blue-50')
                      : dropdownItemClass
                  }`}
                >
                  <div className="text-xs font-medium">{mode.label}</div>
                  <div className="text-[10px] text-gray-400">{mode.desc}</div>
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
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
            title="Switch model"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="2" width="10" height="8" rx="1" />
              <path d="M3 5h2M3 7h4" />
            </svg>
            {selectedModel}
          </button>
          {modelMenuOpen && (
            <div className={`absolute bottom-full right-0 mb-1 w-56 border rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto ${dropdownBgClass}`}>
              <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>Select model</div>
              {availableModels.map(({ provider, models }) => (
                <div key={provider}>
                  <div className={`px-3 py-1 text-xs font-medium capitalize ${subtextClass}`}>{provider}</div>
                  {models.map(model => (
                    <button
                      key={model}
                      onClick={() => { setSelectedModel(model); setModelMenuOpen(false); }}
                      className={`w-full text-left px-5 py-1 text-xs font-mono transition-colors ${
                        selectedModel === model
                          ? (isDark ? 'text-blue-400 bg-blue-900/30' : 'text-blue-600 bg-blue-50')
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
          isDark={isDark}
          btnBaseClass={btnBaseClass}
          hoverClass={hoverClass}
          dropdownBgClass={dropdownBgClass}
        />
      </div>

      {/* File search modal */}
      <FileSearchPanel
        isOpen={fileSearchOpen}
        onClose={() => setFileSearchOpen(false)}
        onSelect={handleFileSelected}
      />
    </div>
  );
}
