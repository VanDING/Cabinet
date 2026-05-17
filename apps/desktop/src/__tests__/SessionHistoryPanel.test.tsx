import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionHistoryPanel } from '../components/SessionHistoryPanel';
import type { Session } from '../hooks/useSessions';

const mockSessions: Session[] = [
  {
    id: 's1',
    title: 'Market Analysis',
    messages: [
      { id: 'm1', role: 'user' as const, content: 'Analyze Q3', timestamp: new Date() },
      { id: 'm2', role: 'assistant' as const, content: 'Here is the analysis...', timestamp: new Date() },
    ],
    attachedFiles: [],
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
  },
  {
    id: 's2',
    title: 'Budget Review',
    messages: [],
    attachedFiles: [],
    createdAt: new Date('2026-05-15'),
    updatedAt: new Date('2026-05-15'),
  },
];

describe('SessionHistoryPanel', () => {
  it('returns null when isOpen is false', () => {
    const { container } = render(
      <SessionHistoryPanel
        isOpen={false}
        onClose={vi.fn()}
        history={[]}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders history list when isOpen', () => {
    render(
      <SessionHistoryPanel
        isOpen={true}
        onClose={vi.fn()}
        history={mockSessions}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Recent Sessions')).toBeInTheDocument();
    expect(screen.getByText('Market Analysis')).toBeInTheDocument();
    expect(screen.getByText('Budget Review')).toBeInTheDocument();
  });

  it('shows message count and date for each session', () => {
    render(
      <SessionHistoryPanel
        isOpen={true}
        onClose={vi.fn()}
        history={mockSessions}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 msgs/)).toBeInTheDocument();
    expect(screen.getByText(/0 msgs/)).toBeInTheDocument();
  });

  it('shows empty state when no history', () => {
    render(
      <SessionHistoryPanel
        isOpen={true}
        onClose={vi.fn()}
        history={[]}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No recent sessions')).toBeInTheDocument();
  });

  it('calls onReopen when clicking a session', () => {
    const onReopen = vi.fn();
    render(
      <SessionHistoryPanel
        isOpen={true}
        onClose={vi.fn()}
        history={mockSessions}
        onReopen={onReopen}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Market Analysis'));
    expect(onReopen).toHaveBeenCalledWith(mockSessions[0]);
  });

  it('calls onDelete when clicking delete button', () => {
    const onDelete = vi.fn();
    render(
      <SessionHistoryPanel
        isOpen={true}
        onClose={vi.fn()}
        history={mockSessions}
        onReopen={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const deleteBtns = screen.getAllByLabelText('Delete session');
    fireEvent.click(deleteBtns[0]!);
    expect(onDelete).toHaveBeenCalledWith('s1');
  });
});
