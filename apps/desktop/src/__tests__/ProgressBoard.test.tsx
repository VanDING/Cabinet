import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../utils/pin.js', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  authHeaders: () => ({}),
  authJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  apiUrl: (path: string) => path,
}));

const { ProgressBoard } = await import('../components/office/ProgressBoard');

const mockProgressData = {
  stats: { total: 5, completed: 2, inProgress: 1, pending: 1, blocked: 1 },
  percent: 40,
  tasks: [
    { id: 't1', title: 'Research market', status: 'completed' as const },
    { id: 't2', title: 'Draft proposal', status: 'in_progress' as const },
    { id: 't3', title: 'Review budget', status: 'pending' as const },
    {
      id: 't4',
      title: 'Get approval',
      status: 'blocked' as const,
      blockedReason: 'Waiting on legal',
    },
  ],
  nextTask: { id: 't3', title: 'Review budget', status: 'pending' as const },
  notes: ['Prioritize market research'],
};

describe('ProgressBoard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<ProgressBoard />);
    expect(screen.getByText('Loading progress...')).toBeInTheDocument();
  });

  it('shows empty state when no tasks', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ tasks: [], stats: { total: 0 } }),
    });
    render(<ProgressBoard />);
    await waitFor(() => {
      expect(screen.getByText(/No tasks tracked yet/)).toBeInTheDocument();
    });
  });

  it('renders task board with progress bar after data loads', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockProgressData),
    });
    render(<ProgressBoard />);
    await waitFor(() => {
      expect(screen.getByText('Task Board')).toBeInTheDocument();
    });
    expect(screen.getByText('2/5 done')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('renders task list with status icons', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockProgressData),
    });
    render(<ProgressBoard />);
    await waitFor(() => {
      expect(screen.getByText('Draft proposal')).toBeInTheDocument();
    });
    expect(screen.getByText('✅')).toBeInTheDocument();
    expect(screen.getByText('🔄')).toBeInTheDocument();
    expect(screen.getByText('🚫')).toBeInTheDocument();
    expect(screen.getByText('⏳')).toBeInTheDocument();
  });

  it('shows next task when present', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockProgressData),
    });
    render(<ProgressBoard />);
    await waitFor(() => {
      expect(screen.getByText('Next Up')).toBeInTheDocument();
    });
    // "Review budget" appears both as nextTask and in the task list
    const occurrences = screen.getAllByText('Review budget');
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('shows blocked reason for blocked tasks', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockProgressData),
    });
    render(<ProgressBoard />);
    await waitFor(() => {
      expect(screen.getByText('Waiting on legal')).toBeInTheDocument();
    });
  });

  it('calls API to update task status on button click', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockProgressData),
    });
    render(<ProgressBoard />);
    await waitFor(() => {
      expect(screen.getByText('Draft proposal')).toBeInTheDocument();
    });

    // Click the complete button on the in_progress task
    const completeBtn = screen.getByTitle('Complete');
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockProgressData),
    });
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/progress',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"status":"completed"'),
        }),
      );
    });
  });
});
