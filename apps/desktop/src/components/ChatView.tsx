import { useRef, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import type { ChatMessage, AttachedFile } from '../hooks/useSessions';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  messages: ChatMessage[];
  isProcessing: boolean;
  attachedFiles: AttachedFile[];
  sessionTitle: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => {
    const codeBlocks: string[] = [];
    let processed = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const langClass = ['bash', 'sh', 'shell'].includes(lang?.toLowerCase()) ? 'bash' : (lang || '');
      codeBlocks.push(`<pre class="code-block ${langClass}"><code>${escapeHtml(code.trim())}</code></pre>`);
      return `%%C${codeBlocks.length - 1}%%`;
    });

    let html = marked.parse(processed) as string;
    codeBlocks.forEach((block, i) => { html = html.replace(`%%C${i}%%`, block); });
    html = html.replace(/\/\w[\w-]*/g, '<span class="skill-tag">$&</span>');
    return html;
  }, [content]);

  return (
    <div
      className="markdown-body text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ChatView({ messages, isProcessing, attachedFiles, sessionTitle }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{sessionTitle}</h2>
      </div>

      {attachedFiles.length > 0 && (
        <div className="flex-shrink-0 px-5 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500">Attached:</span>
          {attachedFiles.map(f => (
            <span key={f.id} className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
              {f.type === 'project' ? f.path : f.name}
            </span>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {messages.length === 0 && !isProcessing && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400 dark:text-gray-500">
              <p className="text-base">Start a conversation</p>
              <p className="text-xs mt-1">Type your message below to begin.</p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="flex gap-3">
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-700 dark:bg-gray-600 text-white'
            }`}>
              {msg.role === 'user' ? 'Y' : 'A'}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <div className="text-gray-800 dark:text-gray-200">
                <MarkdownContent content={msg.content} />
                {msg.isStreaming && (
                  <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            </div>
          </div>
        ))}

        {isProcessing && (!messages.length || !messages[messages.length - 1]?.isStreaming) && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-700 dark:bg-gray-600 text-white flex items-center justify-center text-xs font-bold">A</div>
            <div className="flex-1">
              <span className="text-sm text-gray-400 dark:text-gray-500 italic">Thinking...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
