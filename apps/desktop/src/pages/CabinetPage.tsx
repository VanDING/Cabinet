import React, { useState } from 'react';
import { SecretaryChat, type ChatMessage } from '@cabinet/ui';
import { useToast } from '../components/Toast';

export function CabinetPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: 'Hello Captain! How can I help you today?', timestamp: new Date() },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { addToast } = useToast();

  const handleSend = async (message: string) => {
    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: 'user', content: message, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);

    try {
      const res = await fetch('/api/secretary/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
        body: JSON.stringify({ sessionId: 'default', message }),
      });
      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: data.response ?? 'I received your message.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      addToast('error', 'Failed to send message. Server may be offline.');
      setMessages(prev => [...prev, {
        id: `e_${Date.now()}`, role: 'assistant',
        content: 'Sorry, I could not connect to the server.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto h-full">
      <SecretaryChat
        messages={messages}
        onSend={handleSend}
        isProcessing={isProcessing}
        title="Cabinet — Secretary"
        placeholder="Ask me anything..."
      />
    </div>
  );
}
