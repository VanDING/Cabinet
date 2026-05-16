import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Plus, CheckCircle, LayoutGrid, Terminal } from 'lucide-react';
import type { Session, AttachedFile } from '../hooks/useSessions';
import { FileSearchPanel } from './FileSearchPanel';
import { SessionHistoryPanel } from './SessionHistoryPanel';
import { useSkills } from '../hooks/useSkills';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { ContextButton } from './ContextButton';

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
  ) => void;
  onEnterChat: () => void;
  isProcessing: boolean;
  isDark?: boolean;
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
    return (
      (localStorage.getItem('cabinet-dispatch-mode') as 'single' | 'pipeline' | 'parallel') ??
      'single'
    );
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
  const hoverClass = isDark
    ? 'hover:bg-gray-700 hover:text-gray-200'
    : 'hover:bg-gray-100 hover:text-gray-700';
  const btnBaseClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const dropdownBgClass = isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200';
  const dropdownItemClass = isDark
    ? 'text-gray-200 hover:bg-gray-700'
    : 'text-gray-700 hover:bg-gray-100';

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI__' in window);
  }, []);

  useEffect(() => {
    localStorage.setItem('cabinet-selected-model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('cabinet-dispatch-mode', dispatchMode);
  }, [dispatchMode]);

  // Close menus on outside click
  useOutsideClick(dispatchBtnRef, () => setDispatchMenuOpen(false), dispatchMenuOpen);
  useOutsideClick(addBtnRef, () => setAddMenuOpen(false), addMenuOpen);
  useOutsideClick(skillBtnRef, () => setSkillMenuOpen(false), skillMenuOpen);
  useOutsideClick(modelBtnRef, () => setModelMenuOpen(false), modelMenuOpen);

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
    onSend(sessionId, trimmed, attachedFiles, dispatchMode);
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

  const activeTabClass = isDark
    ? 'bg-gray-800 text-gray-200 border-blue-500'
    : 'bg-white text-gray-800 border-blue-500';
  const inactiveTabClass = isDark
    ? 'text-gray-500 hover:bg-gray-700'
    : 'text-gray-500 hover:bg-gray-200';

  return (
    <div className={`border-t ${borderClass} ${bgClass} flex-shrink-0`}>
      {/* Tab bar */}
      <div className={`flex h-8 items-center gap-1 border-b px-2 ${borderClass} ${tabBgClass}`}>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {sessions.map((session) => {
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
                      : `border ${isDark ? 'border-gray-500' : 'border-gray-400'}`
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
              className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
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
                    key={skill}
                    onClick={() => handleSelectSkill(skill)}
                    className={`w-full px-3 py-1.5 text-left font-mono text-xs ${dropdownItemClass}`}
                  >
                    <span className="mr-1.5 inline-block rounded bg-gray-200 px-1 py-0.5 text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                      /
                    </span>
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
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
            title="Agent dispatch mode"
          >
            <LayoutGrid size={14} />
            {dispatchMode === 'single'
              ? 'Single'
              : dispatchMode === 'pipeline'
                ? 'Pipeline'
                : 'Parallel'}
          </button>
          {dispatchMenuOpen && (
            <div
              className={`absolute bottom-full right-0 z-50 mb-1 w-44 rounded-lg border py-1 shadow-xl ${dropdownBgClass}`}
            >
              <div className={`px-3 py-1 text-xs ${subtextClass} border-b ${borderClass}`}>
                Dispatch Mode
              </div>
              {(
                [
                  { id: 'single', label: 'Single Agent', desc: 'One agent handles everything' },
                  { id: 'pipeline', label: 'Pipeline', desc: 'Planner → Generator → Reviewer' },
                  { id: 'parallel', label: 'Parallel', desc: 'Multiple agents concurrently' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => {
                    setDispatchMode(mode.id);
                    setDispatchMenuOpen(false);
                  }}
                  className={`w-full px-4 py-1.5 text-left transition-colors ${
                    dispatchMode === mode.id
                      ? isDark
                        ? 'bg-blue-900/30 text-blue-400'
                        : 'bg-blue-50 text-blue-600'
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
                          ? isDark
                            ? 'bg-blue-900/30 text-blue-400'
                            : 'bg-blue-50 text-blue-600'
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
