import { useRef, useEffect } from 'react';
import type { ChatMessage, AttachedFile } from '../hooks/useSessions';

interface Props {
  messages: ChatMessage[];
  isProcessing: boolean;
  attachedFiles: AttachedFile[];
  sessionTitle: string;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="my-2 rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
      {lang && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{lang}</span>
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Copy
          </button>
        </div>
      )}
      <pre className="px-4 py-3 overflow-x-auto text-xs font-mono leading-relaxed text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900"><code>{code}</code></pre>
    </div>
  );
}

function BashBlock({ code }: { code: string }) {
  return (
    <div className="my-2 rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-900 dark:bg-black">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <span className="text-xs text-gray-400 font-mono">bash</span>
        <button
          onClick={() => navigator.clipboard.writeText(code)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Copy
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto text-xs font-mono leading-relaxed text-green-400">
        <code>{code.split('\n').map((line, i) => (
          <span key={i} className="block">
            <span className="text-green-600 select-none mr-2">$</span>
            {line || ' '}
          </span>
        ))}</code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  // Parse content for code blocks, bash blocks, and skill tags
  const segments: { type: 'text' | 'code' | 'bash'; content: string; lang?: string }[] = [];
  const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  while ((match = codeRegex.exec(content)) !== null) {
    // Text before this code block
    if (match.index > lastIdx) {
      segments.push({ type: 'text', content: content.slice(lastIdx, match.index) });
    }
    const lang = match[1]?.toLowerCase();
    if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      segments.push({ type: 'bash', content: match[2].trim() });
    } else {
      segments.push({ type: 'code', content: match[2].trim(), lang: lang || undefined });
    }
    lastIdx = match.index + match[0].length;
  }

  // Remaining text
  if (lastIdx < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIdx) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content });
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'code') return <CodeBlock key={i} code={seg.content} lang={seg.lang} />;
        if (seg.type === 'bash') return <BashBlock key={i} code={seg.content} />;
        return (
          <span key={i} className="text-sm whitespace-pre-wrap">
            {seg.content.split(/(\/\w[\w-]*)/g).map((part, j) =>
              part.match(/^\/\w[\w-]*$/)
                ? <span key={j} className="inline-block px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-800/50 text-blue-700 dark:text-blue-300 font-medium text-xs align-middle">{part}</span>
                : <span key={j}>{part}</span>
            )}
          </span>
        );
      })}
    </>
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
      {/* Header bar */}
      <div className="flex-shrink-0 px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{sessionTitle}</h2>
      </div>

      {/* Attached files bar */}
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

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {messages.length === 0 && !isProcessing && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400 dark:text-gray-500">
              <p className="text-base">Start a conversation</p>
              <p className="text-xs mt-1">Type your message in the input below to begin.</p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="flex gap-3">
            {/* Avatar */}
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 dark:bg-gray-600 text-white'
            }`}>
              {msg.role === 'user' ? 'Y' : 'A'}
            </div>

            {/* Message body */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <div className={`${msg.role === 'user' ? 'text-gray-800 dark:text-gray-200' : 'text-gray-700 dark:text-gray-300'}`}>
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
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Assistant</span>
              </div>
              <span className="text-sm text-gray-400 dark:text-gray-500 italic">Thinking...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
