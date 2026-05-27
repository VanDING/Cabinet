import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../components/Toast';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../utils/pin.js', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  authHeaders: () => ({}),
  authJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  apiUrl: (path: string) => path,
}));

const { DecisionReviewPanel } = await import('../components/office/DecisionReviewPanel');

const mockDecision = {
  id: 'dec-42',
  projectId: 'proj-1',
  type: 'strategic' as const,
  level: 'L2' as const,
  status: 'pending' as const,
  title: 'Enter 母婴 Market',
  description: 'Evaluate whether to enter the maternal-infant market.',
  options: [
    { id: 'opt-a', label: 'Enter now', impact: 'Fast growth, high risk' },
    { id: 'opt-b', label: 'Phase in', impact: 'Slow growth, low risk' },
  ],
  captainId: 'captain-1',
  createdAt: '2026-05-01T08:00:00Z',
};

const mockAuditTrail = [
  {
    action: 'created',
    actor: 'secretary',
    changes: { title: 'Enter 母婴 Market' },
    timestamp: '2026-05-01T08:00:00Z',
  },
];

function setupMocks(decisionOverride?: any, auditOverride?: any) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url.includes('/audit')) {
      return Promise.resolve({
        json: () => Promise.resolve({ trail: auditOverride ?? mockAuditTrail }),
      });
    }
    // Decision detail
    return Promise.resolve({
      json: () => Promise.resolve({ decision: decisionOverride ?? mockDecision }),
    });
  });
}

function renderPanel() {
  const onClose = vi.fn();
  const onResolved = vi.fn();
  const result = render(
    <ToastProvider>
      <DecisionReviewPanel decisionId="dec-42" onClose={onClose} onResolved={onResolved} />
    </ToastProvider>,
  );
  return { ...result, onClose, onResolved };
}

describe('DecisionReviewPanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading spinner initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    renderPanel();
    // Should show a loading state (spinner div)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('renders decision title and level after load', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 Market')).toBeInTheDocument();
    });
    expect(screen.getByText('L2')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('renders option cards after load', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Options')).toBeInTheDocument();
    });
    const options = screen.getAllByText('Enter now');
    expect(options.length).toBeGreaterThanOrEqual(1);
    const phaseIn = screen.getAllByText('Phase in');
    expect(phaseIn.length).toBeGreaterThanOrEqual(1);
  });

  it('selects an option on click', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Options')).toBeInTheDocument();
    });
    const options = screen.getAllByText('Enter now');
    // The option button is the parent <button>
    const optionBtn = options[0]!.closest('button');
    fireEvent.click(optionBtn!);
    expect(optionBtn?.className).toContain('border-blue-500');
  });

  it('shows audit trail entries after load', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Decision Trail')).toBeInTheDocument();
    });
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('by secretary')).toBeInTheDocument();
  });

  it('calls onClose on Escape key', async () => {
    setupMocks();
    const { onClose } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 Market')).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on backdrop click', async () => {
    setupMocks();
    const { onClose } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 Market')).toBeInTheDocument();
    });
    const backdrop = document.querySelector('.bg-black\\/30');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('approves decision on Approve button click', async () => {
    setupMocks();
    const { onClose, onResolved } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Options')).toBeInTheDocument();
    });
    // Select first option
    const options = screen.getAllByText('Enter now');
    fireEvent.click(options[0]!.closest('button')!);

    // Mock the approve API call
    mockApiFetch.mockResolvedValueOnce({ json: () => Promise.resolve({}) });

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('rejects decision on Reject button click', async () => {
    setupMocks();
    const { onClose, onResolved } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 Market')).toBeInTheDocument();
    });

    mockApiFetch.mockResolvedValueOnce({ json: () => Promise.resolve({}) });

    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/decisions/dec-42/reject',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(onResolved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "Decision not found" when API returns no decision', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/audit')) {
        return Promise.resolve({ json: () => Promise.resolve({ trail: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ decision: null }) });
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Decision not found')).toBeInTheDocument();
    });
  });

  it('Approve button is disabled when no option selected', async () => {
    setupMocks({ ...mockDecision, chosenOptionId: undefined });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 Market')).toBeInTheDocument();
    });
    expect(screen.getByText('Approve')).toBeDisabled();
  });
});
