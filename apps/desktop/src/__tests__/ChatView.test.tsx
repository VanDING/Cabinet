import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ChatView } from '../components/ChatView';
import type { ChatMessage, AttachedFile } from '../hooks/useSessions';

function renderChatView(props: Partial<Parameters<typeof ChatView>[0]> = {}) {
  return render(
    <BrowserRouter>
      <ChatView
        messages={[]}
        isProcessing={false}
        attachedFiles={[]}
        sessionTitle="Test Session"
        agents={[]}
        {...props}
      />
    </BrowserRouter>,
  );
}

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello world',
    timestamp: new Date('2026-05-15T10:00:00'),
    ...overrides,
  };
}

const attachedFiles: AttachedFile[] = [
  { id: 'f1', name: 'report.pdf', type: 'local' as const, path: '/files/report.pdf' },
  { id: 'f2', name: 'src/index.ts', type: 'project' as const, path: '/project/src/index.ts' },
];

describe('ChatView', () => {
  it('renders session title', () => {
    renderChatView({ sessionTitle: 'My Analysis' });
    expect(screen.getByText('My Analysis')).toBeInTheDocument();
  });

  it('shows empty state with suggestion buttons when no messages', () => {
    renderChatView();
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.getByText('Help me analyze a decision')).toBeInTheDocument();
    expect(screen.getByText('Design a workflow for me')).toBeInTheDocument();
    expect(screen.getByText('Check project status')).toBeInTheDocument();
    expect(screen.getByText('What can you help me with?')).toBeInTheDocument();
  });

  it('dispatches quick-suggestion event on suggestion click', () => {
    const handler = vi.fn();
    window.addEventListener('quick-suggestion', handler);
    renderChatView();
    fireEvent.click(screen.getByText('Help me analyze a decision'));
    expect(handler).toHaveBeenCalled();
    expect((handler.mock.calls[0]![0] as CustomEvent).detail).toBe('Help me analyze a decision');
    window.removeEventListener('quick-suggestion', handler);
  });

  it('renders user message with You label', () => {
    renderChatView({ messages: [makeMsg({ role: 'user', content: 'Hello' })] });
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders assistant message with agent name', () => {
    renderChatView({
      messages: [
        makeMsg({ role: 'assistant', content: 'How can I help?', agentName: 'Secretary' }),
      ],
    });
    expect(screen.getByText('Secretary')).toBeInTheDocument();
    expect(screen.getByText('How can I help?')).toBeInTheDocument();
  });

  it('shows attached files header', () => {
    renderChatView({ attachedFiles });
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('shows Thinking indicator when isProcessing with no streaming message', () => {
    renderChatView({
      isProcessing: true,
      messages: [makeMsg({ role: 'user', content: 'Query' })],
    });
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders markdown content', () => {
    renderChatView({
      messages: [makeMsg({ role: 'assistant', content: '**Bold** and *italic* text.' })],
    });
    // Markdown renders bold text as <strong>
    expect(screen.getByText('Bold')).toBeInTheDocument();
    // The word "text" should appear somewhere in the rendered output
    expect(screen.getByText(/text/)).toBeInTheDocument();
  });

  it('renders multiple messages', () => {
    renderChatView({
      messages: [
        makeMsg({ id: '1', role: 'user', content: 'First' }),
        makeMsg({ id: '2', role: 'assistant', content: 'Second' }),
      ],
    });
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
