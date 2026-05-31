import { useState, useMemo } from 'react';
import type { AgentEvent } from '../types/agent-events';

interface Props {
  sessionId: string;
  agentType: string;
  status: 'active' | 'completed' | 'error';
  events: AgentEvent[];
  onClick: () => void;
  onConfirm?: () => void;
  onRegenerate?: () => void;
}

function formatEvent(event: AgentEvent): { icon: string; label: string; content: string } {
  switch (event.type) {
    case 'thinking':
      return { icon: '💭', label: 'thinking', content: event.content };
    case 'tool_call':
      return { icon: '🔧', label: `tool_call: ${event.name}`, content: JSON.stringify(event.args) };
    case 'tool_result':
      return { icon: '✓', label: `tool_result: ${event.name}`, content: JSON.stringify(event.result) };
    case 'stream_chunk':
    case 'output':
      return { icon: '📄', label: 'output', content: event.content };
    case 'user_input_received':
      return { icon: '👤', label: 'User input', content: event.content };
    case 'error':
      return { icon: '⚠', label: 'error', content: event.message };
    default:
      return { icon: '•', label: event.type, content: '' };
  }
}

export function SubAgentWindow({
  agentType,
  status,
  events,
  onClick,
  onConfirm,
  onRegenerate,
}: Props) {
  const [expanded, setExpanded] = useState(status === 'active');

  const statusDot =
    status === 'active' ? 'animate-pulse bg-accent' : status === 'error' ? 'bg-intent-danger' : 'bg-intent-success';

  const statusLabel = status === 'active' ? 'Running...' : status === 'error' ? 'Error' : 'Completed';

  // Completed sessions default to collapsed; user can expand
  const isHistoryCard = status === 'completed' || status === 'error';

  const renderEvents = useMemo(() => {
    return events.map((event, idx) => {
      const { icon, label, content } = formatEvent(event);
      return (
        <div key={idx} className="flex items-start gap-1.5 text-xs">
          <span className="mt-0.5 select-none">{icon}</span>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[10px] text-content-tertiary">{label}</span>
            {content && (
              <div className="mt-0.5 break-words text-content-secondary">
                {content.length > 200 ? content.slice(0, 200) + '…' : content}
              </div>
            )}
          </div>
        </div>
      );
    });
  }, [events]);

  return (
    <div
      onClick={onClick}
      className={`my-2 overflow-hidden rounded-lg border ${status === 'error' ? 'border-intent-danger' : 'border-border'} bg-surface-elevated transition-shadow hover:shadow-md ${isHistoryCard && !expanded ? 'opacity-80' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${statusDot}`} />
        <span className="text-xs font-medium text-content-secondary">
          Sub-Agent: {agentType}
        </span>
        <span className="text-[10px] text-content-tertiary">{statusLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="rounded px-1 text-[10px] text-content-tertiary hover:bg-surface-muted"
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {events.length === 0 && (
            <div className="text-xs italic text-content-tertiary">Waiting for events...</div>
          )}
          {renderEvents}

          {/* Action buttons (only while active) */}
          {status === 'active' && (
            <div className="flex items-center gap-2 pt-1">
              {onConfirm && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirm();
                  }}
                  className="rounded bg-accent px-2 py-0.5 text-[10px] text-content-inverse hover:bg-accent-hover"
                >
                  Confirm
                </button>
              )}
              {onRegenerate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegenerate();
                  }}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-content-secondary hover:bg-surface-muted"
                >
                  Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
