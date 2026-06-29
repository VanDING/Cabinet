import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  authHeaders: () => ({}),
  authJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  apiUrl: (path: string) => path,
}));

const { EventTimeline } = await import('../components/office/EventTimeline');

describe('EventTimeline', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  test.skip('shows empty state when no events', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ recentEvents: [] }),
    });
    render(<EventTimeline />);
    await waitFor(() => {
      expect(screen.getByText('No recent events.')).toBeInTheDocument();
    });
  });

  it('renders events after data loads', async () => {
    mockApiFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          recentEvents: [
            { message: 'Decision approved', time: '2026-05-17T10:00:00Z' },
            { message: 'Workflow started', time: '2026-05-17T09:30:00Z' },
          ],
        }),
    });
    render(<EventTimeline />);
    await waitFor(() => {
      expect(screen.getByText('Recent Events')).toBeInTheDocument();
    });
    expect(screen.getByText('Decision approved')).toBeInTheDocument();
    expect(screen.getByText('Workflow started')).toBeInTheDocument();
  });

  it('renders heading always', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<EventTimeline />);
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
  });
});
