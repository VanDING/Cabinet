import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, AttachedFile } from '../hooks/useSessions';
import { MeetingCard } from './MeetingCard';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  messages: ChatMessage[];
  isProcessing: boolean;
  attachedFiles: AttachedFile[];
  sessionTitle: string;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => {
    // 1. Strip HTML tags LLM sometimes outputs alongside markdown.
    //    Handles: <p>, </p>, <br/>, <hr />, <li class="x">, etc.
    const cleaned = content.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\s*\/?>/gi, '');

    // 2. Extract and protect code blocks
    const codeBlocks: string[] = [];
    const withCodeBlocks = cleaned.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const langClass = ['bash', 'sh', 'shell'].includes(lang?.toLowerCase()) ? 'bash' : lang || '';
      codeBlocks.push(
        `<pre class="code-block ${langClass}"><code>${escapeHtml(code.trim())}</code></pre>`,
      );
      return `%%CB${codeBlocks.length - 1}%%`;
    });

    // 3. Protect skill tags BEFORE markdown parsing so they don't become
    //    HTML-escaped and don't clash with closing HTML tags from step 1.
    const skillBlocks: string[] = [];
    const withSkillTags = withCodeBlocks.replace(/\/\w[\w-]*/g, (match) => {
      skillBlocks.push(`<span class="skill-tag">${match}</span>`);
      return `%%SK${skillBlocks.length - 1}%%`;
    });

    // 4. Parse markdown
    let html = marked.parse(withSkillTags) as string;

    // 5. Restore code blocks
    codeBlocks.forEach((block, i) => {
      html = html.replace(`%%CB${i}%%`, block);
    });

    // 6. Restore skill tags
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
}: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-5 py-2.5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
          {sessionTitle}
        </h2>
      </div>

      {attachedFiles.length > 0 && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-5 py-1.5 dark:border-gray-700 dark:bg-gray-800">
          <span className="text-xs text-gray-500">{t('chat.attached')}</span>
          {attachedFiles.map((f) => (
            <span
              key={f.id}
              className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            >
              {f.type === 'project' ? f.path : f.name}
            </span>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !isProcessing && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-center text-gray-400 dark:text-gray-500">
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
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
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
          />
        ))}

        {isProcessing && (!messages.length || !messages[messages.length - 1]?.isStreaming) && (
          <div className="flex gap-3">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-white dark:bg-gray-600">
              A
            </div>
            <div className="flex-1">
              <span className="text-sm italic text-gray-400 dark:text-gray-500">{t('chat.thinking')}</span>
            </div>
          </div>
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
}: {
  msg: ChatMessage;
  isProcessing: boolean;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);

  return (
    <div className="group flex gap-3">
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          msg.role === 'user'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-white dark:bg-gray-600'
        }`}
      >
        {t(msg.role === 'user' ? 'chat.you' : 'chat.secretary').charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {msg.role === 'user' ? t('chat.you') : (msg.agentName ?? t('chat.secretary'))}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {msg.timestamp.toLocaleTimeString()}
          </span>
          {!isProcessing && (
            <div className="ml-auto hidden gap-1 group-hover:flex">
              {msg.role === 'user' && onEditMessage && (
                <button
                  onClick={() => { setEditText(msg.content); setEditing(true); }}
                  className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                >
                  {t('chat.edit')}
                </button>
              )}
              {msg.role === 'assistant' && onRegenerate && (
                <button
                  onClick={() => onRegenerate(msg.id)}
                  className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                >
                  {t('chat.regenerate')}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="text-gray-800 dark:text-gray-200">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full rounded border border-blue-300 bg-white p-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-blue-700 dark:bg-gray-800 dark:text-gray-200"
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
                  className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                >
                  {t('chat.saveAndResend')}
                </button>
                <button
                  onClick={() => { setEditText(msg.content); setEditing(false); }}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  {t('chat.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <MarkdownContent content={msg.content} />
              {msg.meeting && <MeetingCard data={msg.meeting} />}
              {msg.isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-blue-500 align-middle" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
