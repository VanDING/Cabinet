import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import hljs from 'highlight.js';
import type { ChatMessage, AttachedFile } from '../hooks/useSessions';
import type { ToolCallStatus } from '../hooks/useSessions';
import { MeetingCard } from './MeetingCard';
import { WorkflowRunCard } from './WorkflowRunCard';
import { TaskPanel } from './TaskPanel';
import { SubAgentCard } from '@cabinet/ui';

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
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-content-tertiary">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent"></span>
            Running {running} tool{running > 1 ? 's' : ''}
          </span>
          {toolCalls
            .filter((tc) => tc.status === 'running')
            .map((tc) => (
              <span
                key={tc.id}
                className="inline-flex items-center gap-1 rounded bg-accent-muted px-1.5 py-0.5 text-accent"
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
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-content-tertiary">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-surface-muted:bg-surface-input"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          {total} tool{total !== 1 ? 's' : ''}
        </button>
        {!expanded &&
          toolCalls.slice(0, 4).map((tc) => (
            <span
              key={tc.id}
              className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5"
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
        <div className="mt-1 space-y-1 rounded border border-border bg-surface-elevated p-2">
          {toolCalls.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2 text-xs">
              <span>{tc.status === 'error' ? '✕' : tc.status === 'running' ? '⟳' : '✓'}</span>
              <span className="font-mono text-content-secondary">
                {formatToolPreview(tc)}
              </span>
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
}: Props) {
  const { t } = useTranslation();
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
    <div className="flex h-full flex-col bg-surface-primary">
      <div className="flex-shrink-0 border-b border-border bg-surface-elevated px-5 py-2.5">
        <h2 className="truncate text-sm font-medium text-content-secondary">
          {sessionTitle}
        </h2>
      </div>

      {attachedFiles.length > 0 && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-surface-elevated px-5 py-1.5">
          <span className="text-xs text-content-tertiary">{t('chat.attached')}</span>
          {attachedFiles.map((f) => (
            <span
              key={f.id}
              className="rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent"
            >
              {f.type === 'project' ? f.path : f.name}
            </span>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-4 pb-48">
        {messages.length === 0 && !isProcessing && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-center text-content-tertiary">
              <p className="text-base">{t('chat.startConversation')}</p>
              <p className="mt-1 text-xs">{t('chat.startHint')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                t('chat.suggestions.analyzeDecision'),
                t('chat.suggestions.designWorkflow'),
                t('chat.suggestions.checkStatus'),
                t('chat.suggestions.whatCanYouDo'),
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    // Dispatch a custom event that ChatPanel listens for
                    window.dispatchEvent(
                      new CustomEvent('quick-suggestion', { detail: suggestion }),
                    );
                  }}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-content-tertiary transition-colors hover:border-accent hover:bg-accent-muted hover:text-accent:border-accent:bg-accent-hover/20:text-accent"
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

        {isProcessing && (!messages.length || !messages[messages.length - 1]?.isStreaming) && (
          <div className="flex gap-3">
            <div className="flex-1">
              <span className="text-sm italic text-content-tertiary">
                {t('chat.thinking')}
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
            className="sticky bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1.5 text-xs text-content-inverse shadow-lg hover:bg-accent-hover"
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
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);

  return (
    <div
      className={`group flex flex-col ${msg.isError ? 'rounded border-l-2 border-intent-danger bg-intent-danger-muted/50 pl-2' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-xs font-medium text-content-secondary">
            {msg.role === 'user' ? t('chat.you') : (msg.agentName ?? t('chat.secretary'))}
          </span>
          <span className="text-xs text-content-tertiary">
            {msg.timestamp.toLocaleTimeString()}
          </span>
          {msg.routing && (
            <span className="inline-flex items-center gap-1 rounded bg-intent-purple-muted px-1.5 py-0.5 text-[10px] text-intent-purple">
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
                  className="rounded px-1.5 py-0.5 text-xs text-content-tertiary hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary"
                >
                  {t('chat.edit')}
                </button>
              )}
              {msg.role === 'assistant' && onRegenerate && (
                <button
                  onClick={() => onRegenerate(msg.id)}
                  className="rounded px-1.5 py-0.5 text-xs text-content-tertiary hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary"
                >
                  {t('chat.regenerate')}
                </button>
              )}
              {onForkMessage && (
                <button
                  onClick={() => onForkMessage(msg.id)}
                  className="rounded px-1.5 py-0.5 text-xs text-content-tertiary hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary"
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
                className="w-full rounded border border-accent bg-surface-primary p-2 text-sm text-content-primary focus:outline-none focus:ring-1 focus:ring-accent"
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
                  className="rounded bg-accent px-3 py-1 text-xs text-content-inverse hover:bg-accent-hover"
                >
                  {t('chat.saveAndResend')}
                </button>
                <button
                  onClick={() => {
                    setEditText(msg.content);
                    setEditing(false);
                  }}
                  className="rounded border border-border px-3 py-1 text-xs text-content-secondary hover:bg-surface-elevated:bg-surface-input"
                >
                  {t('chat.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {msg.isError && (
                <div className="mb-1 flex items-center gap-1 text-xs text-intent-danger">
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
                    className={`mb-2 rounded border px-2 py-1 text-[10px] font-medium ${
                      msg.stepBudget.remaining <= 0
                        ? 'border-intent-danger bg-intent-danger-muted text-intent-danger'
                        : 'border-intent-warning bg-intent-warning-muted text-intent-warning'
                    }`}
                  >
                    {msg.stepBudget.remaining <= 0
                      ? `步骤预算已耗尽 (${msg.stepBudget.maxSteps}/${msg.stepBudget.maxSteps})，任务可能未完成。`
                      : `步骤预算即将耗尽 (${msg.stepBudget.remaining}/${msg.stepBudget.maxSteps})`}
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
                        {t('chat.thinking')} {duration}
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
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-accent bg-accent-muted px-3 py-1 text-xs font-medium text-accent hover:bg-accent-muted disabled:opacity-50"
                >
                  <span>Continue</span>
                  <span>→</span>
                </button>
              )}
              {msg.meeting && <MeetingCard data={msg.meeting} />}
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
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent align-middle" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
