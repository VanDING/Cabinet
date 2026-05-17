import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { ChatPanel } from '../components/ChatPanel';
import type { Session } from '../hooks/useSessions';

const mockSession: Session = {
  id: 's1',
  title: 'Test Chat',
  messages: [],
  attachedFiles: [],
  createdAt: new Date('2026-05-15'),
  updatedAt: new Date('2026-05-15'),
};

const defaultProps = {
  sessions: [mockSession],
  activeSession: mockSession,
  history: [],
  isSessionActive: () => true,
  onCreateSession: vi.fn(() => 'new-session-id'),
  onCloseSession: vi.fn(),
  onSwitchSession: vi.fn(),
  onAddFile: vi.fn(),
  onRemoveFile: vi.fn(),
  onReopenSession: vi.fn(),
  onDeleteHistorySession: vi.fn(),
  onSend: vi.fn(),
  onEnterChat: vi.fn(),
  isProcessing: false,
};

function renderChatPanel(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <ChatPanel {...defaultProps} {...overrides} />
      </ToastProvider>
    </BrowserRouter>,
  );
}

describe('ChatPanel', () => {
  it('renders text input area', () => {
    renderChatPanel();
    const textarea = screen.getByPlaceholderText(/ask anything/i);
    expect(textarea).toBeInTheDocument();
  });

  it('renders toolbar buttons', () => {
    renderChatPanel();
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('/ Skill')).toBeInTheDocument();
  });

  it('shows active session title', () => {
    renderChatPanel();
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
  });

  it('disables textarea when isProcessing is true', () => {
    renderChatPanel({ isProcessing: true });
    const textarea = screen.getByPlaceholderText(/ask anything/i);
    expect(textarea).toBeDisabled();
  });

  it('shows model selector with selected model', () => {
    renderChatPanel();
    expect(screen.getByText(/claude-sonnet/)).toBeInTheDocument();
  });

  it('shows delegation tier selector', () => {
    renderChatPanel();
    expect(screen.getByText('T2')).toBeInTheDocument();
  });

  it('updates input value on typing', () => {
    renderChatPanel();
    const textarea = screen.getByPlaceholderText(/ask anything/i);
    fireEvent.change(textarea, { target: { value: 'Analyze Q3 results' } });
    expect(textarea).toHaveValue('Analyze Q3 results');
  });

  it('calls onSend on Enter key (without Shift)', () => {
    const onSend = vi.fn();
    renderChatPanel({ onSend });
    const textarea = screen.getByPlaceholderText(/ask anything/i);
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('s1', 'Hello', [], undefined, 'claude-sonnet-4-6');
  });

  it('renders without active session gracefully', () => {
    renderChatPanel({ activeSession: undefined, sessions: [] });
    const textarea = screen.getByPlaceholderText(/ask anything/i);
    expect(textarea).toBeInTheDocument();
  });

  it('has clickable Add button', () => {
    renderChatPanel();
    const addBtn = screen.getByText('Add');
    fireEvent.click(addBtn);
    // Should open the add menu with Local file option
    expect(screen.getByText('Local file')).toBeInTheDocument();
  });
});
