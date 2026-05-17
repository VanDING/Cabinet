import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../utils/pin.js', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  authHeaders: () => ({}),
  authJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  apiUrl: (path: string) => path,
}));

const { Deliverables } = await import('../components/office/Deliverables');

function setupMocks(decisionsData: any, dashData: any) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url.includes('/api/decisions')) {
      return Promise.resolve({ json: () => Promise.resolve(decisionsData) });
    }
    if (url.includes('/api/dashboard')) {
      return Promise.resolve({ json: () => Promise.resolve(dashData) });
    }
    return Promise.reject(new Error('Unknown URL'));
  });
}

describe('Deliverables', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<Deliverables />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders milestones progress bar after data loads', async () => {
    setupMocks(
      { decisions: [] },
      { activeProjects: 10, activeWorkflows: 4 },
    );
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('Milestones')).toBeInTheDocument();
    });
    expect(screen.getByText('4/10')).toBeInTheDocument();
  });

  it('renders decisions progress bar after data loads', async () => {
    setupMocks(
      {
        decisions: [
          { id: '1', status: 'approved' },
          { id: '2', status: 'approved' },
          { id: '3', status: 'pending' },
        ],
      },
      { activeProjects: 5, activeWorkflows: 2 },
    );
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('Decisions')).toBeInTheDocument();
    });
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('shows 0% progress when total is 0', async () => {
    setupMocks(
      { decisions: [] },
      { activeProjects: 0, activeWorkflows: 0 },
    );
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('Milestones')).toBeInTheDocument();
    });
    const zeros = screen.getAllByText('0/0');
    expect(zeros.length).toBe(2);
  });

  it('shows full progress when all done', async () => {
    setupMocks(
      { decisions: [{ id: '1', status: 'approved' }] },
      { activeProjects: 3, activeWorkflows: 3 },
    );
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('3/3')).toBeInTheDocument();
    });
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });

  it('hides loading text after data resolves', async () => {
    setupMocks(
      { decisions: [] },
      { activeProjects: 1, activeWorkflows: 0 },
    );
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('Milestones')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
