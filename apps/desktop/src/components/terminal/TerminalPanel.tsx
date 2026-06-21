import { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalTab } from './TerminalTab';

export interface TerminalTabConfig {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface TerminalPanelProps {
  tabs: TerminalTabConfig[];
  activeTabId: string | null;
  onActiveTabChange: (id: string | null) => void;
  onTabClose: (id: string) => void;
  onAddTab: () => void;
  onClose: () => void;
}

export function TerminalPanel({
  tabs,
  activeTabId,
  onActiveTabChange,
  onTabClose,
  onAddTab,
  onClose,
}: TerminalPanelProps) {
  const [height, setHeight] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true);
      startYRef.current = e.clientY;
      startHeightRef.current = height;
    },
    [height],
  );

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      const delta = startYRef.current - e.clientY;
      setHeight(Math.max(80, Math.min(600, startHeightRef.current + delta)));
    };
    const handleUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div
      style={{ height }}
      className="border-border bg-surface-elevated flex shrink-0 flex-col border-t"
    >
      <div
        onMouseDown={handleMouseDown}
        className={`h-1 cursor-row-resize transition-colors ${
          isResizing ? 'bg-accent' : 'hover:bg-accent-muted'
        }`}
      />
      <div className="bg-surface-muted flex shrink-0 items-center justify-between border-b px-2 py-0.5">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onActiveTabChange(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-t px-2 py-1 text-xs transition-colors ${
                activeTabId === tab.id
                  ? 'bg-surface-elevated text-content-primary'
                  : 'text-content-tertiary hover:bg-surface-overlay'
              }`}
            >
              <span className="font-mono">$</span>
              {tab.label}
            </button>
          ))}
          <button
            onClick={onAddTab}
            className="text-content-tertiary hover:text-content-primary shrink-0 rounded px-1.5 py-0.5 text-xs"
            aria-label="New terminal"
            title="New terminal"
          >
            +
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-primary shrink-0 px-1.5 py-0.5 text-xs"
          aria-label="Close terminal panel"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-hidden bg-[#1a1a1a]">
        {activeTab ? (
          <TerminalTab
            id={activeTab.id}
            label={activeTab.label}
            command={activeTab.command}
            args={activeTab.args}
            env={activeTab.env}
            onClose={() => onTabClose(activeTab.id)}
          />
        ) : (
          <div className="text-content-tertiary p-4 text-center text-xs">
            No terminal open. Click + to start a new terminal.
          </div>
        )}
      </div>
    </div>
  );
}
