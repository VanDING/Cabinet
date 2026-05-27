import { createApp } from '../../apps/server/src/index';

export const PIN = '1234';
export const headers = { 'Content-Type': 'application/json', 'x-cabinet-pin': PIN };

export function createTestApp() {
  return createApp();
}

/** Reset delegation tier to T0 for predictable test behavior. */
export async function resetTier(app: ReturnType<typeof createApp>) {
  await app.request('/api/settings/delegation-tier', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ tier: 'T0' }),
  });
}

/** Ensure a test project exists. Returns the project ID so decisions/workflows can reference it. */
export async function seedProject(app: ReturnType<typeof createApp>): Promise<string> {
  const name = `Test Project ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201) {
    const body = await res.json();
    throw new Error(`Failed to seed project: ${JSON.stringify(body)}`);
  }
  const body = await res.json();
  return body.project?.id ?? '';
}

/** Default projectId used by createDecision if none provided. */
let defaultProjectId: string | null = null;
export function getDefaultProjectId() {
  return defaultProjectId;
}
export function setDefaultProjectId(id: string) {
  defaultProjectId = id;
}

export interface DecisionInput {
  projectId?: string;
  type?: string;
  title: string;
  description: string;
  options?: { id: string; label: string; impact: string }[];
}

export async function createDecision(app: ReturnType<typeof createApp>, input: DecisionInput) {
  const res = await app.request('/api/decisions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: defaultProjectId ?? 'proj-1',
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
