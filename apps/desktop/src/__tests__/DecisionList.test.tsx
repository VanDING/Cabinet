import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

// Import after mock setup so the mocked module is used
const { DecisionList } = await import('../components/office/DecisionList');

function renderDecisionList(onSelectDecision?: (id: string) => void) {
  return render(
    <ToastProvider>
      <DecisionList onSelectDecision={onSelectDecision} />
    </ToastProvider>,
  );
}

const mockDecisions = [
  {
    id: 'dec-1',
    title: 'Enter 母婴 market',
    description: 'Analyze market entry feasibility.',
    level: 'L2',
    status: 'pending',
    type: 'strategic',
    options: [
      { id: 'opt-a', label: 'Enter now', impact: 'High' },
      { id: 'opt-b', label: 'Wait', impact: 'Medium' },
    ],
    projectId: 'proj-1',
    captainId: 'captain-1',
    createdAt: '2026-01-01',
  },
  {
    id: 'dec-2',
    title: 'Hire ML Engineer',
    description: 'Expand AI team.',
    level: 'L0',
    status: 'pending',
    type: 'action',
    options: [{ id: 'opt-a', label: 'Approve', impact: 'Low' }],
    projectId: 'proj-1',
    captainId: 'captain-1',
    createdAt: '2026-01-02',
  },
];

describe('DecisionList', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows heading while fetching', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    renderDecisionList();
    expect(screen.getByText('Pending Decisions')).toBeInTheDocument();
  });

  it('renders decisions after fetch', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ decisions: mockDecisions }),
    });
    renderDecisionList();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 market')).toBeInTheDocument();
    });
    expect(screen.getByText('Hire ML Engineer')).toBeInTheDocument();
  });

  it('shows empty state when no decisions', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ decisions: [] }),
    });
    renderDecisionList();
    await waitFor(() => {
      expect(screen.getByText('No pending decisions')).toBeInTheDocument();
    });
  });

  it('renders level badges with correct class', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ decisions: mockDecisions }),
    });
    renderDecisionList();
    await waitFor(() => {
      const l2Badge = screen.getByText('L2');
      expect(l2Badge.className).toContain('amber');
      const l0Badge = screen.getByText('L0');
      expect(l0Badge.className).toContain('green');
    });
  });

  it('calls onSelectDecision when clicking a decision', async () => {
    const onSelect = vi.fn();
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ decisions: mockDecisions }),
    });
    renderDecisionList(onSelect);
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 market')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Enter 母婴 market'));
    expect(onSelect).toHaveBeenCalledWith('dec-1');
  });

  it('shows option labels and "+N more" overflow', async () => {
    const manyOptions = [
      { id: 'opt-a', label: 'A', impact: 'Low' },
      { id: 'opt-b', label: 'B', impact: 'Low' },
      { id: 'opt-c', label: 'C', impact: 'Low' },
      { id: 'opt-d', label: 'D', impact: 'Low' },
      { id: 'opt-e', label: 'E', impact: 'Low' },
    ];
    mockApiFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          decisions: [{ ...mockDecisions[0], options: manyOptions }],
        }),
    });
    renderDecisionList();
    await waitFor(() => {
      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });
  });

  it('refetches on ws:decision_created custom event', async () => {
    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ decisions: [mockDecisions[0]] }),
    });
    renderDecisionList();
    await waitFor(() => {
      expect(screen.getByText('Enter 母婴 market')).toBeInTheDocument();
    });

    mockApiFetch.mockResolvedValue({
      json: () => Promise.resolve({ decisions: mockDecisions }),
    });
    act(() => {
      window.dispatchEvent(new Event('ws:decision_created'));
    });
    await waitFor(() => {
      expect(screen.getByText('Hire ML Engineer')).toBeInTheDocument();
    });
  });
});
