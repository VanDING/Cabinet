import { useState, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface SecretaryChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isProcessing?: boolean;
  placeholder?: string;
  title?: string;
}

export function SecretaryChat({
  messages,
  onSend,
  isProcessing,
  placeholder,
  title,
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
    <div className="flex h-full flex-col rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
      {title && (
        <div className="rounded-t-lg border-b bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
        </div>
      )}
      <div
        ref={scrollRef}
        className="max-h-[600px] min-h-[400px] flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-gray-400" />
              )}
              <span className="mt-1 block text-xs opacity-50">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
        {isProcessing && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-gray-100 px-4 py-2 dark:bg-gray-700">
              <span className="text-sm text-gray-400 dark:text-gray-500">Thinking...</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t p-3 dark:border-gray-700">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={placeholder ?? 'Type your message...'}
          disabled={isProcessing}
          className="flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800"
        />
        <button
          onClick={handleSend}
          disabled={isProcessing || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
