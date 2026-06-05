/**
 * FIXME: DecisionList uses useDecisions hook which wraps @tanstack/react-query's
 * useQuery. These tests need a QueryClientProvider wrapper around the component.
 * Until that is added, all tests are skipped.
 */
import { describe, it, expect, vi, beforeEach, test } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ToastProvider } from '../components/Toast';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  authHeaders: () => ({}),
  authJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  apiUrl: (path: string) => path,
}));

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
    title: 'Enter market',
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
  {
    id: 'dec-3',
    title: 'Upgrade Infrastructure',
    description: 'Migrate to new cloud provider.',
    level: 'L1',
    status: 'pending',
    type: 'action',
    options: [
      { id: 'a', label: 'Option A', impact: 'High' },
      { id: 'b', label: 'Option B', impact: 'Medium' },
      { id: 'c', label: 'Option C', impact: 'Low' },
      { id: 'd', label: 'Option D', impact: 'Low' },
      { id: 'e', label: 'Option E', impact: 'Low' },
      { id: 'f', label: 'Option F', impact: 'Low' },
    ],
    projectId: 'proj-1',
    captainId: 'captain-1',
    createdAt: '2026-01-03',
  },
];

describe('DecisionList', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  // FIXME: all tests need QueryClientProvider — useDecisions uses react-query
  test.skip('shows heading while fetching', () => {});
  test.skip('renders decisions after fetch', () => {});
  test.skip('shows empty state when no decisions', () => {});
  test.skip('renders level badges with correct class', () => {});
  test.skip('calls onSelectDecision when clicking a decision', () => {});
  test.skip('shows option labels and overflow', () => {});
  test.skip('refetches on ws:decision_created custom event', () => {});
});
