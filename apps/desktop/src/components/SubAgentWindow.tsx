import { useState, useMemo, useRef, useCallback } from 'react';
import type { AgentEvent } from '../types/agent-events';

type SubAgentStatus = 'active' | 'waiting_for_user' | 'completed' | 'error';

interface Props {
  sessionId: string;
  agentType: string;
  status: SubAgentStatus;
  events: AgentEvent[];
  onClick: () => void;
  onConfirm?: () => void;
  onRegenerate?: () => void;
  onSendFeedback?: (feedback: string) => void;
  onApprove?: () => void;
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
    case 'status':
      return { icon: '🔄', label: `status: ${event.status}`, content: '' };
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
  onSendFeedback,
  onApprove,
}: Props) {
  const [expanded, setExpanded] = useState(status === 'active' || status === 'waiting_for_user');
  const [feedback, setFeedback] = useState('');
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  const handleSendFeedback = useCallback(() => {
    if (!feedback.trim()) return;
    onSendFeedback?.(feedback.trim());
    setFeedback('');
  }, [feedback, onSendFeedback]);

  const statusDot =
    status === 'active'
      ? 'animate-pulse bg-accent'
      : status === 'waiting_for_user'
        ? 'bg-amber-400'
        : status === 'error'
          ? 'bg-intent-danger'
          : 'bg-intent-success';

  const statusLabel =
    status === 'active'
      ? 'Running...'
      : status === 'waiting_for_user'
        ? 'Waiting for your review'
        : status === 'error'
          ? 'Error'
          : 'Completed';

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
      className={`my-2 overflow-hidden rounded-lg border ${status === 'error' ? 'border-intent-danger' : status === 'waiting_for_user' ? 'border-amber-400' : 'border-border'} bg-surface-elevated transition-shadow hover:shadow-md ${isHistoryCard && !expanded ? 'opacity-80' : ''}`}
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

          {/* Feedback input when waiting for user review */}
          {status === 'waiting_for_user' && (
            <div className="flex flex-col gap-2 pt-1">
              <textarea
                ref={feedbackRef}
                placeholder="Provide feedback (e.g., 'change X', 'add Y', 'approved', 'cancel')"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendFeedback();
                  }
                }}
                className="w-full rounded border border-border bg-surface-muted px-2 py-1 text-xs text-content-primary placeholder:text-content-tertiary resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                {onApprove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onApprove();
                    }}
                    className="rounded bg-accent px-2 py-0.5 text-[10px] text-content-inverse hover:bg-accent-hover"
                  >
                    Approve &amp; Deploy
                  </button>
                )}
                {onSendFeedback && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSendFeedback();
                    }}
                    disabled={!feedback.trim()}
                    className="rounded border border-border px-2 py-0.5 text-[10px] text-content-secondary hover:bg-surface-muted disabled:opacity-40"
                  >
                    Send Feedback
                  </button>
                )}
              </div>
            </div>
          )}

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
