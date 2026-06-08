import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import type { ChatMessage, AttachedFile, Session } from '../hooks/useSessions';
import type { ToolCallStatus } from '../hooks/useSessions';
import { WorkflowRunCard } from './WorkflowRunCard';
import { TaskPanel } from './TaskPanel';
import { SubAgentWindow } from './SubAgentWindow';
import { SubAgentCard, DecryptedText } from '@cabinet/ui';
import type { AgentEvent } from '../types/agent-events';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  messages: ChatMessage[];
  isProcessing: boolean;
  attachedFiles: AttachedFile[];
  sessionTitle: string;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  onContinue?: (messageId: string) => void;
  childSessions?: Session[];
  onSubAgentClick?: (sessionId: string) => void;
  onSubAgentApprove?: (sessionId: string) => void;
  onResetInputTarget?: () => void;
  onBack?: () => void;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatToolPreview(tc: ToolCallStatus): string {
  const args = tc.args ?? {};
  const preview = (val: unknown) => {
    const s = String(val ?? '');
    return s.length > 30 ? s.slice(0, 30) + '…' : s;
  };
  switch (tc.name) {
    case 'read_file':
    case 'writeFile':
    case 'editFile':
    case 'applyPatch':
    case 'deleteFile':
    case 'fileInfo':
    case 'indexDocument':
      return args.filePath ? `${tc.name}(${preview(args.filePath)})` : tc.name;
    case 'execCommand':
      return args.command ? `${tc.name}(${preview(args.command)})` : tc.name;
    case 'searchFiles':
      return args.pattern ? `${tc.name}(${preview(args.pattern)})` : tc.name;
    case 'searchContent':
      return args.pattern ? `${tc.name}(${preview(args.pattern)})` : tc.name;
    case 'listDirectory':
      return args.dirPath ? `${tc.name}(${preview(args.dirPath)})` : tc.name;
    case 'webFetch':
      return args.url ? `${tc.name}(${preview(args.url)})` : tc.name;
    case 'httpRequest':
      return args.url ? `${tc.name}(${preview(args.url)})` : tc.name;
    case 'moveFile':
      return args.source ? `${tc.name}(${preview(args.source)})` : tc.name;
    case 'copyFile':
      return args.source ? `${tc.name}(${preview(args.source)})` : tc.name;
    default:
      return tc.name;
  }
}

const ToolCallSummary = memo(function ToolCallSummary({
  toolCalls,
  isStreaming,
}: {
  toolCalls: ToolCallStatus[];
  isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const total = toolCalls.length;
  const running = toolCalls.filter((tc) => tc.status === 'running').length;
  if (total === 0) return null;

  // During streaming with running tools: show compact inline indicator with previews
  if (isStreaming && running > 0) {
    return (
      <div className="my-1">
        <div className="text-content-tertiary flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="inline-flex items-center gap-1">
            <span className="bg-accent h-2 w-2 animate-pulse rounded-full"></span>
            Running {running} tool{running > 1 ? 's' : ''}
          </span>
          {toolCalls
            .filter((tc) => tc.status === 'running')
            .map((tc) => (
              <span
                key={tc.id}
                className="bg-accent-muted text-accent inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5"
              >
                <span className="opacity-70">⟳</span>
                {formatToolPreview(tc)}
              </span>
            ))}
        </div>
      </div>
    );
  }

  // After completion: compact summary with expand toggle
  return (
    <div className="my-1">
      <div className="text-content-tertiary flex flex-wrap items-center gap-1.5 text-[10px]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="hover:bg-surface-muted bg-surface-input inline-flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          {total} tool{total !== 1 ? 's' : ''}
        </button>
        {!expanded &&
          toolCalls.slice(0, 4).map((tc) => (
            <span
              key={tc.id}
              className="bg-surface-muted inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5"
            >
              <span>{tc.status === 'error' ? '✕' : '✓'}</span>
              {formatToolPreview(tc)}
            </span>
          ))}
        {!expanded && toolCalls.length > 4 && (
          <span className="text-content-tertiary">+{toolCalls.length - 4} more</span>
        )}
      </div>
      {expanded && (
        <div className="border-border bg-surface-elevated mt-1 space-y-1 rounded-sm border p-2">
          {toolCalls.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2 text-xs">
              <span>{tc.status === 'error' ? '✕' : tc.status === 'running' ? '⟳' : '✓'}</span>
              <span className="text-content-secondary font-mono">{formatToolPreview(tc)}</span>
              {tc.status === 'error' && <span className="text-intent-danger">error</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => {
    // 1. Extract and protect code blocks (with syntax highlighting)
    const codeBlocks: string[] = [];
    const withCodeBlocks = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const trimmed = code.trim();
      let highlighted: string;
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(trimmed, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(trimmed).value;
        }
      } catch {
        highlighted = escapeHtml(trimmed);
      }
      codeBlocks.push(
        `<pre class="code-block"><code class="hljs ${lang || ''}">${highlighted}</code></pre>`,
      );
      return `%%CB${codeBlocks.length - 1}%%`;
    });

    // 2. Protect URLs BEFORE skill-tag matching so web links aren't styled as skills
    const urlBlocks: string[] = [];
    const withUrlsProtected = withCodeBlocks.replace(/https?:\/\/[^\s<>"']+/g, (match) => {
      urlBlocks.push(escapeHtml(match));
      return `%%URL${urlBlocks.length - 1}%%`;
    });

    // 3. Protect skill tags BEFORE markdown parsing so they don't become HTML-escaped
    // Match /skill-name but not file paths like /usr/bin or /api/secretary/chat
    const skillBlocks: string[] = [];
    const withSkillTags = withUrlsProtected.replace(
      /\/(?![/.\\])[a-zA-Z][\w-]{0,19}(?![\w./\\])/g,
      (match) => {
        skillBlocks.push(`<span class="skill-tag">${match}</span>`);
        return `%%SK${skillBlocks.length - 1}%%`;
      },
    );

    // 4. Parse markdown
    let html = marked.parse(withSkillTags) as string;

    // 5. Restore code blocks
    codeBlocks.forEach((block, i) => {
      html = html.replace(`%%CB${i}%%`, block);
    });

    // 6. Restore URLs (as plain links, not skill-styled)
    urlBlocks.forEach((url, i) => {
      html = html.replace(`%%URL${i}%%`, url);
    });

    // 7. Restore skill tags
    skillBlocks.forEach((block, i) => {
      html = html.replace(`%%SK${i}%%`, block);
    });

    return html;
  }, [content]);

  return <div className="markdown-body text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
});

export const ChatView = memo(function ChatView({
  messages,
  isProcessing,
  attachedFiles,
  sessionTitle,
  onEditMessage,
  onRegenerate,
  onForkMessage,
  onContinue,
  childSessions,
  onSubAgentClick,
  onSubAgentApprove,
  onResetInputTarget,
  onBack,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track whether user is near bottom; only auto-scroll if they are
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 80;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isNearBottomRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      className="flex h-full flex-col"
      onClick={(e) => {
        // Only reset if clicking the background (not a message or sub-agent window)
        if (e.currentTarget === e.target) {
          onResetInputTarget?.();
        }
      }}
    >
      <div className="border-border bg-surface-elevated flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2.5">
        <h2 className="text-content-secondary min-w-0 flex-1 truncate text-sm font-medium">
          {sessionTitle}
        </h2>
        {onBack && (
          <button
            onClick={onBack}
            className="border-border bg-surface-overlay/80 text-content-secondary hover:bg-surface-elevated flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors"
          >
            <ArrowLeft size={12} />
            Back
          </button>
        )}
      </div>

      {attachedFiles.length > 0 && (
        <div className="border-border bg-surface-elevated flex shrink-0 flex-wrap items-center gap-1.5 border-b px-5 py-1.5">
          <span className="text-content-tertiary text-xs">{'Attached:'}</span>
          {attachedFiles.map((f) => (
            <span
              key={f.id}
              className="bg-accent-muted text-accent rounded-sm px-1.5 py-0.5 text-xs"
            >
              {f.type === 'project' ? f.path : f.name}
            </span>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-4 pb-48">
        {messages.length === 0 && !isProcessing && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-content-tertiary text-center">
              <p className="text-base">{'Start a conversation'}</p>
              <p className="mt-1 text-xs">
                {'Ask a question, analyze a decision, or design a workflow.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                'Help me analyze a decision',
                'Design a workflow for me',
                'Check project status',
                'What can you help me with?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    // Dispatch a custom event that ChatPanel listens for
                    window.dispatchEvent(
                      new CustomEvent('quick-suggestion', { detail: suggestion }),
                    );
                  }}
                  className="border-border text-content-tertiary hover:border-accent hover:bg-accent-muted hover:text-accent:border-accent:bg-accent-hover/20:text-accent rounded-full border px-3 py-1.5 text-xs transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            isProcessing={isProcessing}
            onEditMessage={onEditMessage}
            onRegenerate={onRegenerate}
            onForkMessage={onForkMessage}
            onContinue={onContinue}
          />
        ))}

        {childSessions && childSessions.length > 0 && (
          <div className="space-y-2">
            {childSessions.map((child) => (
              <SubAgentWindow
                key={child.id}
                sessionId={child.id}
                agentType={child.agentType ?? 'unknown'}
                status={
                  (child.status ?? 'active') as
                    | 'active'
                    | 'waiting_for_user'
                    | 'completed'
                    | 'error'
                }
                events={(child.events ?? []) as import('../types/agent-events').AgentEvent[]}
                onClick={() => onSubAgentClick?.(child.id)}
                onApprove={
                  child.status === 'waiting_for_user'
                    ? () => onSubAgentApprove?.(child.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {isProcessing && (!messages.length || !messages[messages.length - 1]?.isStreaming) && (
          <div className="flex gap-3">
            <div className="flex-1">
              <span className="text-content-tertiary text-sm italic">
                <DecryptedText text={'Thinking...'} speed={50} maxIterations={8} />
              </span>
            </div>
          </div>
        )}

        {showScrollButton && (
          <button
            onClick={() => {
              const el = scrollRef.current;
              if (el) {
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                isNearBottomRef.current = true;
                setShowScrollButton(false);
              }
            }}
            className="bg-accent text-content-inverse hover:bg-accent-hover sticky bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs shadow-lg"
          >
            New messages ↓
          </button>
        )}
      </div>
    </div>
  );
});

const MessageRow = memo(function MessageRow({
  msg,
  isProcessing,
  onEditMessage,
  onRegenerate,
  onForkMessage,
  onContinue,
}: {
  msg: ChatMessage;
  isProcessing: boolean;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  onContinue?: (messageId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);

  return (
    <div
      className={`group flex flex-col ${msg.isError ? 'border-intent-danger bg-intent-danger-muted/50 rounded border-l-2 pl-2' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-content-secondary text-xs font-medium">
            {msg.role === 'user' ? 'You' : (msg.agentName ?? 'Secretary')}
          </span>
          <span className="text-content-tertiary text-xs">
            {msg.timestamp.toLocaleTimeString()}
          </span>
          {msg.routing && (
            <span className="bg-intent-purple-muted text-intent-purple inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px]">
              <span>{msg.routing.from}</span>
              <span>→</span>
              <span>{msg.routing.to}</span>
            </span>
          )}
          {!isProcessing && (
            <div className="ml-auto hidden gap-1 group-hover:flex">
              {msg.role === 'user' && onEditMessage && (
                <button
                  onClick={() => {
                    setEditText(msg.content);
                    setEditing(true);
                  }}
                  className="text-content-tertiary hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary rounded-sm px-1.5 py-0.5 text-xs"
                >
                  {'Edit'}
                </button>
              )}
              {msg.role === 'assistant' && onRegenerate && (
                <button
                  onClick={() => onRegenerate(msg.id)}
                  className="text-content-tertiary hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary rounded-sm px-1.5 py-0.5 text-xs"
                >
                  {'Regenerate'}
                </button>
              )}
              {onForkMessage && (
                <button
                  onClick={() => onForkMessage(msg.id)}
                  className="text-content-tertiary hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary rounded-sm px-1.5 py-0.5 text-xs"
                  title="Fork session from here"
                >
                  Fork
                </button>
              )}
            </div>
          )}
        </div>
        <div className="text-content-primary">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="border-accent bg-surface-primary text-content-primary focus:ring-accent w-full rounded-sm border p-2 text-sm focus:ring-1 focus:outline-hidden"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (editText.trim() && editText !== msg.content) {
                      onEditMessage?.(msg.id, editText.trim());
                    }
                    setEditing(false);
                  }}
                  className="bg-accent text-content-inverse hover:bg-accent-hover rounded-sm px-3 py-1 text-xs"
                >
                  {'Save & Resend'}
                </button>
                <button
                  onClick={() => {
                    setEditText(msg.content);
                    setEditing(false);
                  }}
                  className="border-border text-content-secondary hover:bg-surface-elevated bg-surface-input rounded-sm border px-3 py-1 text-xs"
                >
                  {'Cancel'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {msg.isError && (
                <div className="text-intent-danger mb-1 flex items-center gap-1 text-xs">
                  <span>⚠</span>
                  <span>Error</span>
                </div>
              )}
              {(msg.semanticTasks || msg.tasks) && (
                <TaskPanel semanticTasks={msg.semanticTasks} tasks={msg.tasks} />
              )}
              {msg.stepBudget &&
                msg.stepBudget.remaining <= Math.ceil(msg.stepBudget.maxSteps * 0.25) && (
                  <div
                    className={`border-border mb-2 rounded border px-2 py-1 text-[10px] font-medium ${
                      msg.stepBudget.remaining <= 0
                        ? 'border-intent-danger bg-intent-danger-muted text-intent-danger'
                        : 'border-intent-warning bg-intent-warning-muted text-intent-warning'
                    }`}
                  >
                    {msg.stepBudget.remaining <= 0
                      ? `Step budget exhausted (${msg.stepBudget.maxSteps}/${msg.stepBudget.maxSteps}), task may be incomplete.`
                      : `Step budget running low (${msg.stepBudget.remaining}/${msg.stepBudget.maxSteps})`}
                  </div>
                )}
              {msg.subAgentActivities && msg.subAgentActivities.length > 0 && (
                <div className="mt-2">
                  {msg.subAgentActivities.map((activity, idx) => (
                    <SubAgentCard
                      key={`${msg.id}_sub_${idx}`}
                      activity={activity}
                      visibility="detailed"
                    />
                  ))}
                </div>
              )}
              {msg.thinking &&
                (() => {
                  const duration = msg.thinkingDurationMs
                    ? `(${(msg.thinkingDurationMs / 1000).toFixed(1)}s)`
                    : '';
                  return (
                    <details className="thinking-block mb-2">
                      <summary className="thinking-summary">
                        {'Thinking...'} {duration}
                      </summary>
                      <pre className="thinking-content">
                        {msg.thinking.replace(/\n?<!--segment-->\n?/g, '\n')}
                      </pre>
                    </details>
                  );
                })()}
              <MarkdownContent content={msg.content} />
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <ToolCallSummary toolCalls={msg.toolCalls} isStreaming={msg.isStreaming} />
              )}
              {msg.content.includes('[INCOMPLETE: max_steps_reached]') && onContinue && (
                <button
                  onClick={() => onContinue(msg.id)}
                  disabled={isProcessing}
                  className="border-accent bg-accent-muted text-accent hover:bg-accent-muted mt-2 inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  <span>Continue</span>
                  <span>→</span>
                </button>
              )}
              {msg.meeting && (
                <span className="text-muted text-sm">Meeting: {msg.meeting.topic}</span>
              )}
              {(() => {
                const call = msg.toolCalls?.find(
                  (tc) => tc.name === 'runWorkflow' && tc.status === 'completed',
                );
                if (!call?.result) return null;
                try {
                  const parsed = JSON.parse(call.result);
                  if (parsed.runId && parsed.status) {
                    return (
                      <WorkflowRunCard
                        data={{
                          runId: parsed.runId,
                          status: parsed.status,
                          steps: parsed.steps,
                        }}
                      />
                    );
                  }
                } catch {
                  /* ignore parse errors */
                }
                return null;
              })()}
              {msg.isStreaming && (
                <span className="bg-accent ml-0.5 inline-block h-4 w-2 animate-pulse align-middle" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
