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

const { CostChart } = await import('../components/office/CostChart');

const mockCostHistory = [
  { date: '2026-05-10', cost: 1.2, calls: 50, byModel: { 'claude-sonnet-4-6': 1.0, 'gpt-4o': 0.2 } },
  { date: '2026-05-11', cost: 0.8, calls: 30, byModel: { 'claude-sonnet-4-6': 0.8 } },
];

describe('CostChart', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows "No data yet" when history is empty', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: [], budgetStatus: { daily: 0, weekly: 0, monthly: 0 }, limits: { daily: 5, weekly: 25, monthly: 100 } }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('No data yet')).toBeInTheDocument();
    });
  });

  it('renders cost summary after data loads', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({
        history: mockCostHistory,
        budgetStatus: { daily: 2.0, weekly: 10, monthly: 40 },
        limits: { daily: 5, weekly: 25, monthly: 100 },
      }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    // Total cost: 1.2 + 0.8 = 2.0
    // Total cost = $1.2 + $0.8 = $2.0, rendered with toFixed(2) or toFixed(3)
    const costEls = screen.getAllByText(/\$2\.00/);
    expect(costEls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders total calls count', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({
        history: mockCostHistory,
        budgetStatus: { daily: 0, weekly: 0, monthly: 0 },
        limits: { daily: 5, weekly: 25, monthly: 100 },
      }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('80')).toBeInTheDocument();
    });
  });

  it('toggles between stacked and bar view modes', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({
        history: mockCostHistory,
        budgetStatus: { daily: 0, weekly: 0, monthly: 0 },
        limits: { daily: 5, weekly: 25, monthly: 100 },
      }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });

    const totalBtn = screen.getByText('Total');
    const byModelBtn = screen.getByText('By Model');

    fireEvent.click(totalBtn);
    // Total button should become active
    expect(totalBtn.className).toContain('bg-blue');

    fireEvent.click(byModelBtn);
    expect(byModelBtn.className).toContain('bg-blue');
  });

  it('shows budget limits', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({
        history: mockCostHistory,
        budgetStatus: { daily: 1.5, weekly: 8, monthly: 30 },
        limits: { daily: 5, weekly: 25, monthly: 100 },
      }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    expect(screen.getByText(/Daily limit: \$5/)).toBeInTheDocument();
    expect(screen.getByText(/Weekly: \$25/)).toBeInTheDocument();
    expect(screen.getByText(/Monthly: \$100/)).toBeInTheDocument();
  });

  it('shows model legend in stacked mode', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({
        history: mockCostHistory,
        budgetStatus: { daily: 0, weekly: 0, monthly: 0 },
        limits: { daily: 5, weekly: 25, monthly: 100 },
      }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    // Default is stacked mode, legend should show model names
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
  });
});
