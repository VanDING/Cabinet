import { useState, useMemo } from 'react';
import type { AgentEvent } from '../types/agent-events';

type SubAgentStatus = 'active' | 'waiting_for_user' | 'completed' | 'error';

interface Props {
  sessionId: string;
  agentType: string;
  status: SubAgentStatus;
  events: AgentEvent[];
  onClick: () => void;
  onApprove?: () => void;
}

interface Turn {
  user?: string;
  assistant?: string;
  thinking: string[];
  toolCalls: { name: string; args: Record<string, unknown>; result?: unknown }[];
}

function eventsToTurns(events: AgentEvent[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (const event of events) {
    if (event.type === 'user_input_received') {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        user: event.content,
        assistant: undefined,
        thinking: [],
        toolCalls: [],
      };
    } else if (event.type === 'output' || event.type === 'stream_chunk') {
      if (!currentTurn) {
        currentTurn = { thinking: [], toolCalls: [] };
      }
      currentTurn.assistant = (currentTurn.assistant ?? '') + event.content;
    } else if (event.type === 'thinking') {
      if (!currentTurn) currentTurn = { thinking: [], toolCalls: [] };
      currentTurn.thinking.push(event.content);
    } else if (event.type === 'tool_call') {
      if (!currentTurn) currentTurn = { thinking: [], toolCalls: [] };
      currentTurn.toolCalls.push({
        name: event.name,
        args: event.args as Record<string, unknown>,
      });
    } else if (event.type === 'tool_result') {
      if (!currentTurn) currentTurn = { thinking: [], toolCalls: [] };
      const last = currentTurn.toolCalls[currentTurn.toolCalls.length - 1];
      if (last && last.name === event.name) {
        last.result = event.result;
      }
    }
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}

export function SubAgentWindow({ agentType, status, events, onClick, onApprove }: Props) {
  const [expanded, setExpanded] = useState(status === 'active' || status === 'waiting_for_user');
  const [showThinking, setShowThinking] = useState<Record<number, boolean>>({});

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

  const turns = useMemo(() => eventsToTurns(events), [events]);

  return (
    <div
      onClick={onClick}
      className={`my-2 overflow-hidden rounded-lg border ${status === 'error' ? 'border-intent-danger' : status === 'waiting_for_user' ? 'border-amber-400' : 'border-border'} bg-surface-elevated transition-shadow hover:shadow-md ${isHistoryCard && !expanded ? 'opacity-80' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${statusDot}`} />
        <span className="text-content-secondary text-xs font-medium">Sub-Agent: {agentType}</span>
        <span className="text-content-tertiary text-[10px]">{statusLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="text-content-tertiary hover:bg-surface-muted rounded px-1 text-[10px]"
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-border space-y-3 border-t px-3 py-2">
          {turns.length === 0 && events.length === 0 && (
            <div className="text-content-tertiary text-xs italic">Waiting for events...</div>
          )}

          {turns.map((turn, idx) => (
            <div key={idx} className="space-y-2">
              {turn.user && (
                <div className="flex justify-end">
                  <div className="bg-accent-muted text-accent max-w-[85%] rounded-lg px-3 py-2 text-xs">
                    {turn.user}
                  </div>
                </div>
              )}

              {turn.assistant && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] space-y-1">
                    <div className="border-border bg-surface-primary text-content-secondary rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap">
                      {turn.assistant}
                    </div>

                    {(turn.thinking.length > 0 || turn.toolCalls.length > 0) && (
                      <div className="pl-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowThinking((prev) => ({
                              ...prev,
                              [idx]: !prev[idx],
                            }));
                          }}
                          className="text-content-tertiary hover:text-content-secondary text-[10px]"
                        >
                          {showThinking[idx] ? '▼' : '▶'}{' '}
                          {turn.thinking.length > 0 && `${turn.thinking.length} thinking`}
                          {turn.thinking.length > 0 && turn.toolCalls.length > 0 && ' + '}
                          {turn.toolCalls.length > 0 && `${turn.toolCalls.length} tool calls`}
                        </button>

                        {showThinking[idx] && (
                          <div className="border-border bg-surface-muted mt-1 space-y-1 rounded border p-2">
                            {turn.thinking.map((t, i) => (
                              <div
                                key={`th-${i}`}
                                className="text-content-tertiary text-[10px] whitespace-pre-wrap"
                              >
                                {t}
                              </div>
                            ))}
                            {turn.toolCalls.map((tc, i) => (
                              <div key={`tc-${i}`} className="flex items-start gap-1.5 text-[10px]">
                                <span className="text-content-secondary font-mono">{tc.name}</span>
                                <span className="text-content-tertiary">
                                  {Object.entries(tc.args)
                                    .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
                                    .join(', ')}
                                </span>
                                {tc.result !== undefined && (
                                  <span className="text-intent-success">
                                    →{' '}
                                    {typeof tc.result === 'string'
                                      ? tc.result.slice(0, 30)
                                      : JSON.stringify(tc.result).slice(0, 30)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Unpaired events (thinking/tool calls without a turn yet) */}
          {events.length > 0 && turns.length === 0 && (
            <div className="space-y-1">
              {events.map((event, idx) => {
                if (
                  event.type === 'user_input_received' ||
                  event.type === 'output' ||
                  event.type === 'stream_chunk'
                )
                  return null;
                return (
                  <div key={`raw-${idx}`} className="flex items-start gap-1.5 text-xs">
                    <span className="mt-0.5 select-none">
                      {event.type === 'thinking'
                        ? '💭'
                        : event.type === 'tool_call'
                          ? '🔧'
                          : event.type === 'tool_result'
                            ? '✓'
                            : '•'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-content-tertiary font-mono text-[10px]">
                        {event.type}
                      </span>
                      {'content' in event && event.content && (
                        <div className="text-content-secondary mt-0.5 break-words">
                          {event.content.slice(0, 200)}
                          {event.content.length > 200 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Approve button when waiting for user */}
          {status === 'waiting_for_user' && onApprove && (
            <div className="flex justify-end pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove();
                }}
                className="bg-accent text-content-inverse hover:bg-accent-hover rounded px-3 py-1 text-[10px]"
              >
                Approve &amp; Deploy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
