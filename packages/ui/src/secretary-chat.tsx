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

export function SecretaryChat({ messages, onSend, isProcessing, placeholder, title }: SecretaryChatProps) {
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
    <div className="flex flex-col h-full border rounded-lg bg-white">
      {title && (
        <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
          <h2 className="font-semibold text-gray-800">{title}</h2>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[600px]">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-800'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.isStreaming && (
                <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
              )}
              <span className="text-xs opacity-50 block mt-1">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
        {isProcessing && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <span className="text-sm text-gray-400">Thinking...</span>
            </div>
          </div>
        )}
      </div>
      <div className="border-t p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={placeholder ?? 'Type your message...'}
          disabled={isProcessing}
          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
        <button
          onClick={handleSend}
          disabled={isProcessing || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
