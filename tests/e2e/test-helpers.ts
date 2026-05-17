import { createApp } from '../../apps/server/src/index';

export const PIN = '1234';
export const headers = { 'Content-Type': 'application/json', 'x-cabinet-pin': PIN };

export function createTestApp() {
  return createApp();
}

export interface DecisionInput {
  projectId?: string;
  type?: string;
  title: string;
  description: string;
  options?: { id: string; label: string; impact: string }[];
}

export async function createDecision(
  app: ReturnType<typeof createApp>,
  input: DecisionInput,
) {
  const res = await app.request('/api/decisions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: 'proj-1',
      type: 'action',
      options: [
        { id: 'opt-a', label: 'Option A', impact: 'High' },
        { id: 'opt-b', label: 'Option B', impact: 'Medium' },
        { id: 'opt-c', label: 'Option C', impact: 'Low' },
        { id: 'opt-d', label: 'Option D', impact: 'None' },
      ],
      ...input,
    }),
  });
  const body = await res.json();
  return { res, body };
}
