import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { externalAgentRouter, generateTaskToken } from '../external-agent.js';
import { setServerContext } from '../../context/state.js';

// ── Env ──────────────────────────────────────────────────────────

const ORIGINAL_CABINET_SECRET = process.env.CABINET_SECRET;

beforeAll(() => {
  process.env.CABINET_SECRET = 'test-secret-key-for-hmac';
});

afterAll(() => {
  if (ORIGINAL_CABINET_SECRET) {
    process.env.CABINET_SECRET = ORIGINAL_CABINET_SECRET;
  } else {
    delete process.env.CABINET_SECRET;
  }
});

// ── Mocks ────────────────────────────────────────────────────────

const mockContextSlot = {
  version: 1,
  project: { name: 'test', goals: [] },
  memories: [],
  preferences: {},
  files: [],
  discoveries: [{ type: 'existing', summary: 'pre-existing discovery' }],
  previous_outputs: ['prev-output'],
  security: { level: 'low', maxRetries: 3 },
};

let sessionManager: Record<string, any>;
let eventBus: Record<string, any>;
let decisionService: Record<string, any>;
let deliverableRepo: Record<string, any>;
let mockLogger: Record<string, any>;

function buildMockCtx() {
  return {
    sessionManager,
    agentEventBus: eventBus,
    decisionService,
    deliverableRepo,
    logger: mockLogger,
  };
}

beforeEach(() => {
  const localSlots: Record<string, any> = {
    'test-session-1': JSON.parse(JSON.stringify(mockContextSlot)),
  };

  sessionManager = {
    getSessionByTaskId: vi.fn().mockReturnValue(null),
    get: vi.fn().mockResolvedValue(null),
    setContextSlot: vi.fn((id: string, slot: any) => {
      localSlots[id] = slot;
    }),
    setDeliverable: vi.fn(),
    getContextSlot: vi.fn((id: string) => localSlots[id] ?? undefined),
  };

  eventBus = {
    publish: vi.fn(),
  };

  decisionService = {
    create: vi.fn().mockReturnValue({ id: 'dec_123', status: 'pending' }),
  };

  deliverableRepo = {
    insert: vi.fn(),
  };

  mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
});

// ── Mock broadcast via vi.mock (path relative to this test file) ──

vi.mock('../../ws/handler.js', () => ({
  broadcast: vi.fn(),
}));

// ── Test app ──────────────────────────────────────────────────────

function createTestApp() {
  const app = new Hono();
  app.route('/api/slot', externalAgentRouter);
  app.route('/api/external', externalAgentRouter);
  return app;
}

function validToken(taskId = 'task-1'): string {
  return generateTaskToken(taskId);
}

function agentKeyToken(): string {
  return 'agent_key_permanent_key_value_here';
}

// ── Pure function tests ──────────────────────────────────────────

describe('generateTaskToken', () => {
  it('generates a token starting with task_', () => {
    expect(generateTaskToken('abc')).toMatch(/^task_abc_/);
  });

  it('generates a token with hex HMAC suffix', () => {
    const token = generateTaskToken('xyz');
    const parts = token.split('_');
    const hmac = parts[parts.length - 1];
    expect(hmac).toMatch(/^[a-f0-9]+$/);
  });

  it('produces unique tokens for different task IDs', () => {
    const t1 = generateTaskToken('task-a');
    const t2 = generateTaskToken('task-b');
    expect(t1).not.toBe(t2);
  });
});

// ── Route tests: GET /api/slot/:taskId/read ──────────────────────

describe('GET /api/slot/:taskId/read', () => {
  beforeEach(() => {
    setServerContext(buildMockCtx() as any);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createTestApp();
    const res = await app.request('/api/slot/task-1/read');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Missing Authorization header');
  });

  it('returns 401 with invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: 'Bearer bad' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid token');
  });

  it('returns 404 when session is not found', async () => {
    const app = createTestApp();
    sessionManager.getSessionByTaskId.mockReturnValue(null);
    sessionManager.get.mockReturnValue(null);

    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Session not found');
  });

  it('returns 404 when session has no contextSlot', async () => {
    const app = createTestApp();
    const sessionNoSlot = { id: 'test-session-no-slot', parentId: 'p1' };
    sessionManager.getSessionByTaskId.mockReturnValue(sessionNoSlot);

    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Context slot not initialized');
  });

  it('returns 200 with slot data on success', async () => {
    const app = createTestApp();
    const sessionWithSlot = { id: 'test-session-1', parentId: 'parent-session-1' };
    sessionManager.getSessionByTaskId.mockReturnValue(sessionWithSlot);

    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.discoveries).toHaveLength(1);
    expect(body.discoveries[0].type).toBe('existing');
  });

  it('returns 200 using agent_key_ token', async () => {
    const app = createTestApp();
    const sessionWithSlot = { id: 'test-session-1', parentId: 'parent-session-1' };
    sessionManager.getSessionByTaskId.mockReturnValue(sessionWithSlot);

    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: `Bearer ${agentKeyToken()}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 403 when token taskId mismatches route param', async () => {
    const app = createTestApp();
    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: `Bearer ${validToken('other-task')}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Token does not match task');
  });

  it('returns 500 on internal error', async () => {
    const app = createTestApp();
    sessionManager.getSessionByTaskId.mockImplementation(() => {
      throw new Error('db failure');
    });

    const res = await app.request('/api/slot/task-1/read', {
      headers: { Authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal error');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ── Route tests: POST /api/slot/:taskId/write ────────────────────

describe('POST /api/slot/:taskId/write', () => {
  beforeEach(() => {
    setServerContext(buildMockCtx() as any);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createTestApp();
    const res = await app.request('/api/slot/task-1/write', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/slot/task-1/write', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid request body', async () => {
    const app = createTestApp();
    const res = await app.request('/api/slot/task-1/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discoveries: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 200 and updates slot with discoveries', async () => {
    const app = createTestApp();
    const session = { id: 'test-session-1', parentId: 'parent-session-1' };
    sessionManager.getSessionByTaskId.mockReturnValue(session);

    const res = await app.request('/api/slot/task-1/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discoveries: [{ type: 'bug', summary: 'Found a bug' }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.taskId).toBe('task-1');

    expect(eventBus.publish).toHaveBeenCalled();
    expect(sessionManager.setContextSlot).toHaveBeenCalledWith(
      'test-session-1',
      expect.objectContaining({
        discoveries: expect.arrayContaining([{ type: 'bug', summary: 'Found a bug' }]),
      }),
    );
  });

  it('returns 200 and updates slot with previous_outputs', async () => {
    const app = createTestApp();
    const session = { id: 'test-session-1', parentId: 'parent-session-1' };
    sessionManager.getSessionByTaskId.mockReturnValue(session);

    const res = await app.request('/api/slot/task-1/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previous_outputs: ['output-1', 'output-2'],
      }),
    });

    expect(res.status).toBe(200);
    expect(sessionManager.setContextSlot).toHaveBeenCalled();
  });

  it('returns 200 with no session (graceful no-op)', async () => {
    const app = createTestApp();
    sessionManager.getSessionByTaskId.mockReturnValue(null);
    sessionManager.get.mockResolvedValue(null);

    const res = await app.request('/api/slot/task-1/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discoveries: [{ type: 'info', summary: 'something' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('returns 500 on internal error', async () => {
    const app = createTestApp();
    sessionManager.getSessionByTaskId.mockImplementation(() => {
      throw new Error('oops');
    });

    const res = await app.request('/api/slot/task-1/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discoveries: [{ type: 'x', summary: 'y' }] }),
    });
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ── Route tests: POST /api/external/decisions ────────────────────

describe('POST /api/external/decisions', () => {
  beforeEach(() => {
    setServerContext(buildMockCtx() as any);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/decisions', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/decisions', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty body', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 when title is empty', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'execution',
        title: '',
        description: 'desc',
        source: { agent_id: 'a1', task_id: 't1' },
        options: [{ label: 'L1', value: 'v1' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 and creates a decision', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'execution',
        title: 'Approve deployment',
        description: 'Should we deploy to production?',
        urgency: 'red',
        source: { agent_id: 'agent-1', task_id: 'task-1', capability: 'deploy' },
        options: [
          { label: 'Deploy now', value: 'deploy_now' },
          { label: 'Rollback', value: 'rollback' },
        ],
        callback_url: 'https://example.com/callback',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision_id).toBe('dec_123');
    expect(body.status).toBe('pending');
    expect(body.callback_url).toBe('https://example.com/callback');
    expect(decisionService.create).toHaveBeenCalledOnce();
  });

  it('uses default urgency=green when not provided', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'action',
        title: 'Minor change',
        description: 'Small config tweak',
        source: { agent_id: 'agent-1', task_id: 'task-1' },
        options: [{ label: 'OK', value: 'ok' }],
      }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 on internal error', async () => {
    const app = createTestApp();
    decisionService.create.mockImplementation(() => {
      throw new Error('service down');
    });

    const res = await app.request('/api/external/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'strategic',
        title: 'Big decision',
        description: 'desc',
        source: { agent_id: 'a1', task_id: 't1' },
        options: [{ label: 'L1', value: 'v1' }],
      }),
    });
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ── Route tests: POST /api/external/deliverables ─────────────────

describe('POST /api/external/deliverables', () => {
  beforeEach(() => {
    setServerContext(buildMockCtx() as any);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/deliverables', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty body', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 when required fields missing', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', content: 'C' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 and creates a deliverable', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'agent-1',
        task_id: 'task-1',
        title: 'Refactored module',
        type: 'code',
        content: 'console.log("hello")',
        metadata: {
          language: 'javascript',
          files: ['src/index.js'],
          tokens_used: 1500,
          duration_ms: 12000,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deliverable_id).toBeDefined();
    expect(body.deliverable_id).toMatch(/^d_/);

    expect(deliverableRepo.insert).toHaveBeenCalledOnce();
    const inserted = deliverableRepo.insert.mock.calls[0][0];
    expect(inserted.title).toBe('Refactored module');
    expect(inserted.type).toBe('code');
    expect(inserted.project_id).toBe('default');
    expect(inserted.tags).toContain('external_agent');
  });

  it('publishes event when session is found', async () => {
    const app = createTestApp();
    const session = { id: 'test-session-1', parentId: 'parent-session-1' };
    sessionManager.getSessionByTaskId.mockReturnValue(session);

    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'agent-1',
        task_id: 'task-1',
        title: 'Output',
        content: 'result data',
      }),
    });

    expect(res.status).toBe(200);
    expect(eventBus.publish).toHaveBeenCalledWith(
      'test-session-1',
      'parent-session-1',
      expect.objectContaining({ type: 'completed' }),
    );
    expect(sessionManager.setDeliverable).toHaveBeenCalledWith('test-session-1', 'result data');
  });

  it('defaults type to code when not provided', async () => {
    const app = createTestApp();
    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'agent-1',
        task_id: 'task-1',
        title: 'Report',
        content: 'some text',
      }),
    });

    expect(res.status).toBe(200);
    const inserted = deliverableRepo.insert.mock.calls[0][0];
    expect(inserted.type).toBe('code');
  });

  it('returns 500 on internal error', async () => {
    const app = createTestApp();
    deliverableRepo.insert.mockImplementation(() => {
      throw new Error('db error');
    });

    const res = await app.request('/api/external/deliverables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentKeyToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'agent-1',
        task_id: 'task-1',
        title: 'T',
        content: 'C',
      }),
    });
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
