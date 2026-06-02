import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  authHeaders: () => ({}),
  authJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  apiUrl: (path: string) => path,
}));

const { CostChart } = await import('../components/office/CostChart');

const lastWeek = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - 6 + i);
  return d.toISOString().slice(0, 10);
});

const mockHistory = [
  { date: lastWeek[0]!, cost: 0.5, tokens: 3200 },
  { date: lastWeek[1]!, cost: 1.2, tokens: 8500 },
  { date: lastWeek[2]!, cost: 0.8, tokens: 5200 },
  { date: lastWeek[3]!, cost: 2.0, tokens: 14300 },
  { date: lastWeek[4]!, cost: 1.5, tokens: 10200 },
  { date: lastWeek[5]!, cost: 0.3, tokens: 1800 },
  { date: lastWeek[6]!, cost: 1.1, tokens: 7600 },
];

describe('CostChart', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows "No data yet" when history is empty', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: [] }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('No data yet')).toBeInTheDocument();
    });
  });

  it('renders Cost Analysis header after data loads', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: mockHistory }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
  });

  it('renders period switcher buttons', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: mockHistory }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
  });

  it('shows cost subtotal in Daily mode (last day)', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: mockHistory }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    // Last day cost is 1.10
    expect(screen.getByText('¥1.10')).toBeInTheDocument();
  });

  it('shows token subtotal in Daily mode (last day)', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: mockHistory }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    // Last day tokens is 7600
    expect(screen.getByText('7,600')).toBeInTheDocument();
  });

  it('switches to Weekly and shows weekly sum', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: mockHistory }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Weekly'));

    // Weekly cost sum: 0.5+1.2+0.8+2.0+1.5+0.3+1.1 = 7.4
    await waitFor(() => {
      expect(screen.getByText('¥7.40')).toBeInTheDocument();
    });
    // Weekly token sum: 3200+8500+5200+14300+10200+1800+7600 = 50800
    expect(screen.getByText('50,800')).toBeInTheDocument();
  });

  it('has chart section labels', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ history: mockHistory }),
    });
    render(<CostChart />);
    await waitFor(() => {
      expect(screen.getByText('Cost Analysis')).toBeInTheDocument();
    });
    expect(screen.getByText('Cost (7-day)')).toBeInTheDocument();
    expect(screen.getByText('Tokens (7-day)')).toBeInTheDocument();
  });
});
