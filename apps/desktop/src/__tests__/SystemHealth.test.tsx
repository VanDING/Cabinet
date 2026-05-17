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

const { SystemHealth } = await import('../components/office/SystemHealth');

const mockHealth = {
  system: {
    cpu: { cores: 8 },
    memory: { processMB: '256 MB', systemFreeMB: '4.2 GB' },
    database: { sizeMB: '12.5 MB' },
    uptime: { process: 3600 },
  },
  metrics: { totalCalls: 1250 },
  backup: { available: true },
};

describe('SystemHealth', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<SystemHealth />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders system health data after load', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockHealth),
    });
    render(<SystemHealth />);
    await waitFor(() => {
      expect(screen.getByText('System Health')).toBeInTheDocument();
    });
    expect(screen.getByText('8 cores')).toBeInTheDocument();
    expect(screen.getByText('256 MB')).toBeInTheDocument();
    expect(screen.getByText('1250')).toBeInTheDocument();
  });

  it('shows backup Active status', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockHealth),
    });
    render(<SystemHealth />);
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  it('shows backup N/A when unavailable', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({
        ...mockHealth,
        backup: { available: false },
      }),
    });
    render(<SystemHealth />);
    await waitFor(() => {
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  it('shows uptime in minutes', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve(mockHealth),
    });
    render(<SystemHealth />);
    await waitFor(() => {
      expect(screen.getByText('60m')).toBeInTheDocument();
    });
  });
});
