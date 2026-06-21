import { memo } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AgentInfo } from '../../hooks/useAgents.js';

interface AgentTopBarProps {
  agents: AgentInfo[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  terminalEnabled: boolean;
  sessionTitle: string;
  onBack?: () => void;
}

const statusColor: Record<string, string> = {
  active: 'bg-intent-success',
  idle: 'bg-intent-warning',
  offline: 'bg-content-tertiary',
};

export const AgentTopBar = memo(function AgentTopBar({
  agents,
  activeAgentId,
  onSelectAgent,
  sidebarOpen,
  onToggleSidebar,
  terminalOpen,
  onToggleTerminal,
  terminalEnabled,
  sessionTitle,
  onBack,
}: AgentTopBarProps) {
  return (
    <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-[var(--border-color)] bg-[var(--surface-elevated)] px-3">
      {/* Agent avatars */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {agents.map((agent) => {
          const isActive = agent.id === activeAgentId;
          return (
            <button
              key={agent.id}
              title={agent.name}
              onClick={() => onSelectAgent(agent.id)}
              className={`relative flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                isActive
                  ? 'border-accent shadow-sm'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <span
                className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold"
                style={{ color: 'var(--content-primary)' }}
              >
                {agent.name.charAt(0).toUpperCase()}
              </span>
              <span
                className={`status-dot absolute bottom-0 right-0 h-[10px] w-[10px] rounded-full border-2 border-[var(--surface-elevated)] ${statusColor[agent.status] ?? 'bg-content-tertiary'}`}
              />
              {isActive && (
                <span className="absolute -bottom-[2px] left-1/2 h-[3px] w-[20px] -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="bg-border h-6 w-px shrink-0" />

      {/* Session title */}
      <h2 className="text-content-secondary min-w-0 flex-1 truncate text-sm font-medium">
        {sessionTitle}
      </h2>

      {/* Right-side buttons: back + session toggle + terminal */}
      <div className="flex shrink-0 items-center gap-1">
        {onBack && (
          <button
            onClick={onBack}
            className="border-border bg-surface-overlay/80 text-content-secondary hover:bg-surface-elevated flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={12} />
            Back
          </button>
        )}
        <button
          aria-label="Toggle session list"
          onClick={onToggleSidebar}
          className={`flex h-[32px] w-[32px] items-center justify-center rounded-md border border-[var(--border-color)] text-content-secondary transition-colors hover:bg-[var(--surface-muted)] ${
            sidebarOpen ? 'bg-[var(--surface-muted)]' : ''
          }`}
          title="Session list"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button
          aria-label="Toggle terminal"
          onClick={onToggleTerminal}
          disabled={!terminalEnabled}
          className={`flex h-[32px] w-[32px] items-center justify-center rounded-md border border-[var(--border-color)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40 ${
            terminalOpen ? 'bg-[var(--surface-muted)]' : ''
          }`}
          title={terminalEnabled ? 'Terminal' : 'Terminal requires a CLI agent'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
      </div>
    </div>
  );
});
