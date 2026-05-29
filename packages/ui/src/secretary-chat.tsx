import { useState, useRef, useEffect } from 'react';
import { SubAgentCard, type SubAgentActivity } from './sub-agent-card.js';
import { DecisionCard } from './decision-card.js';
import type { Decision } from '@cabinet/types';

export type AgentVisibility = 'detailed' | 'summary' | 'hidden' | 'expert';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  subAgentActivities?: SubAgentActivity[];
  decision?: Decision;
}

export interface SecretaryChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isProcessing?: boolean;
  placeholder?: string;
  title?: string;
  agentVisibility?: AgentVisibility;
  onDecisionApprove?: (decisionId: string, optionId: string) => void;
  onDecisionReject?: (decisionId: string) => void;
}

function parseDecisionMarkers(content: string): { text: string; decisionId?: string } {
  const match = content.match(/\[\[DECISION:([^\]]+)\]\]/);
  if (match) {
    return {
      text: content.replace(match[0], '').trim(),
      decisionId: match[1],
    };
  }
  return { text: content };
}

export function SecretaryChat({
  messages,
  onSend,
  isProcessing,
  placeholder,
  title,
  agentVisibility = 'detailed',
  onDecisionApprove,
  onDecisionReject,
}: SecretaryChatProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex h-full flex-col rounded-lg border bg-surface-primary">
      {title && (
        <div className="rounded-t-lg border-b border-border bg-surface-elevated px-4 py-3">
          <h2 className="font-semibold text-content-primary">{title}</h2>
        </div>
      )}
      <div
        ref={scrollRef}
        className="max-h-[600px] min-h-[400px] flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.map((msg) => {
          const parsed = parseDecisionMarkers(msg.content);
          return (
            <div key={msg.id}>
              <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-accent text-content-inverse'
                      : 'bg-surface-muted text-content-primary'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{parsed.text || msg.content}</p>
                  {msg.isStreaming && (
                    <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-gray-400" />
                  )}
                  <span className="mt-1 block text-xs opacity-50">
                    {msg.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
              {msg.decision && (
                <div className={`${msg.role === 'user' ? 'ml-auto' : ''} mt-2 max-w-[80%]`}>
                  <DecisionCard
                    decision={msg.decision}
                    variant="full"
                    onApprove={onDecisionApprove}
                    onReject={onDecisionReject}
                  />
                </div>
              )}
              {msg.subAgentActivities && msg.subAgentActivities.length > 0 && (
                <div className={`${msg.role === 'user' ? 'ml-auto' : ''} max-w-[80%]`}>
                  {msg.subAgentActivities.map((activity, idx) => (
                    <SubAgentCard
                      key={`${msg.id}_sub_${idx}`}
                      activity={activity}
                      visibility={agentVisibility === 'expert' ? 'detailed' : agentVisibility}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {isProcessing && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-surface-muted px-4 py-2">
              <span className="text-sm text-content-tertiary">Thinking...</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={placeholder ?? 'Type your message...'}
          disabled={isProcessing}
          className="flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none disabled:bg-surface-elevated"
        />
        <button
          onClick={handleSend}
          disabled={isProcessing || !input.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-content-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
