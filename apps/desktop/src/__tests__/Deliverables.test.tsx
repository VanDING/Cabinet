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

const { Deliverables } = await import('../components/office/Deliverables');

describe('Deliverables', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<Deliverables />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders deliverables after data loads', async () => {
    mockApiFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          deliverables: [
            { id: 'd1', title: 'Q3 Analysis Report', type: 'report', createdAt: '2026-05-01' },
            { id: 'd2', title: 'Architecture Diagram', type: 'diagram', createdAt: '2026-05-15' },
            { id: 'd3', title: 'Meeting Notes', type: 'notes', createdAt: '2026-05-20' },
          ],
        }),
    });
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('Q3 Analysis Report')).toBeInTheDocument();
    });
    expect(screen.getByText('Architecture Diagram')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
    // Shows "View all" link since items > 0
    expect(screen.getByText('View all')).toBeInTheDocument();
  });

  it('shows empty state when no deliverables', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ deliverables: [] }),
    });
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('No deliverables yet')).toBeInTheDocument();
    });
  });

  it('hides loading text after data resolves', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ deliverables: [] }),
    });
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('No deliverables yet')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('renders header with Deliverables title', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ deliverables: [] }),
    });
    render(<Deliverables />);
    await waitFor(() => {
      expect(screen.getByText('Deliverables')).toBeInTheDocument();
    });
  });

  it('uses projectId in API URL when provided', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ deliverables: [] }),
    });
    render(<Deliverables projectId="proj-123" />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/projects/proj-123/deliverables',
        expect.anything(),
      );
    });
  });
});
