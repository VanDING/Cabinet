import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ExternalTask, ExternalTaskResult } from '../../adapters/types.js';
import type { HarnessRuntime } from '../../adapters/harness-runtime.js';
import type {
  InteractiveExternalAgentOptions,
  SquadRouterLike,
} from '../../daemon/interactive-external-agent.js';
import { InteractiveExternalAgent } from '../../daemon/interactive-external-agent.js';
import type { InitContext, Deliverable } from '../../interactive-sub-agent.js';
import type { AgentEvent } from '@cabinet/events';

// ── Helpers ──────────────────────────────────────────────────────────

const makeHarnessRuntime = (overrides: Partial<HarnessRuntime> = {}): HarnessRuntime => ({
  agentId: 'test-agent',
  protocol: 'cli',
  harnessId: 'generic',
  start: vi.fn(),
  stop: vi.fn(),
  healthCheck: vi.fn(),
  dispatchTask: vi.fn(),
  cancelTask: vi.fn(),
  convertPrompt: vi.fn(),
  parseOutput: vi.fn(),
  extractMetrics: vi.fn(),
  injectSkill: vi.fn(),
  discoverSessions: vi.fn(),
  getAdapter: vi.fn(),
  getCapabilities: vi.fn(),
  ...overrides,
});

const makeInitContext = (overrides: Partial<InitContext> = {}): InitContext => ({
  sessionId: 'session-1',
  parentSessionId: 'parent-1',
  projectId: 'project-1',
  captainId: 'captain-1',
  message: 'hello',
  ...overrides,
});

const makeCompletedResult = (overrides: Partial<ExternalTaskResult> = {}): ExternalTaskResult => ({
  task_id: 'task-1',
  status: 'completed',
  output: 'Hello! How can I help?',
  audit: {
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:00:01Z',
    tokens_used: 100,
    model: 'gpt-4',
  },
  ...overrides,
});

const makeFailedResult = (overrides: Partial<ExternalTaskResult> = {}): ExternalTaskResult => ({
  task_id: 'task-1',
  status: 'failed',
  error: 'Something went wrong',
  audit: { started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:00:01Z' },
  ...overrides,
});

const makeSquadRouter = (overrides: Partial<SquadRouterLike> = {}): SquadRouterLike => ({
  route: vi.fn(),
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────

describe('InteractiveExternalAgent', () => {
  let harness: HarnessRuntime;
  let options: InteractiveExternalAgentOptions;

  beforeEach(() => {
    harness = makeHarnessRuntime();
    options = {
      agentId: 'test-agent',
      harnessRuntime: harness,
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('sets default maxTurns and turnTimeoutMs', () => {
      const agent = new InteractiveExternalAgent(options);
      expect(agent.getStatus()).toBe('waiting_for_user');
      expect(agent.getCurrentTarget()).toBe('test-agent');
    });

    it('accepts custom maxTurns and turnTimeoutMs', () => {
      const agent = new InteractiveExternalAgent({
        ...options,
        maxTurns: 5,
        turnTimeoutMs: 10_000,
      });
      expect(agent.getStatus()).toBe('waiting_for_user');
    });

    it('accepts a squadRouter', () => {
      const router = makeSquadRouter();
      const agent = new InteractiveExternalAgent({ ...options, squadRouter: router });
      expect(agent.getCurrentTarget()).toBe('test-agent');
    });
  });

  describe('init()', () => {
    it('sets status to running and dispatches task', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      expect(agent.getStatus()).toBe('waiting_for_user');
      expect(harness.dispatchTask).toHaveBeenCalledTimes(1);
    });

    it('adds initial message to chat history', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext({ message: 'hello' }));

      const history = agent.getChatHistory();
      expect(history.length).toBe(2); // user + agent response
      expect(history[0]).toMatchObject({ role: 'user', content: 'hello' });
      expect(history[1]).toMatchObject({ role: 'agent', content: 'Hello! How can I help?' });
    });

    it('sets status to error when dispatch fails', async () => {
      harness.dispatchTask = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      expect(agent.getStatus()).toBe('error');
    });

    it('emits a status event on init', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const events: AgentEvent[] = [];
      const agent = new InteractiveExternalAgent(options);
      agent.onEvent.on('event', (e) => events.push(e));

      await agent.init(makeInitContext());

      const statusEvents = events.filter((e) => e.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('onUserInput()', () => {
    it('dispatches task and stores agent response', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      await agent.onUserInput('what is the plan?');

      const history = agent.getChatHistory();
      expect(history.length).toBe(4); // user, agent, user, agent
      expect(history[2]).toMatchObject({ role: 'user', content: 'what is the plan?' });
      expect(history[3]).toMatchObject({ role: 'agent', content: 'Hello! How can I help?' });
    });

    it('transitions status: running → waiting_for_user', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());
      expect(agent.getStatus()).toBe('waiting_for_user');

      await agent.onUserInput('next step?');

      expect(agent.getStatus()).toBe('waiting_for_user');
    });

    it('ignores input when status is completed', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());
      await agent.finalize();

      await agent.onUserInput('still here?');

      // dispatchTask called only during init
      expect(harness.dispatchTask).toHaveBeenCalledTimes(1);
    });

    it('ignores input when status is error', async () => {
      harness.dispatchTask = vi.fn().mockRejectedValue(new Error('fail'));

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());
      expect(agent.getStatus()).toBe('error');

      await agent.onUserInput('retry?');

      // dispatchTask should not have been called again (still 1 call from init)
      expect(harness.dispatchTask).toHaveBeenCalledTimes(1);
    });

    it('auto-finalizes when maxTurns is reached', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent({ ...options, maxTurns: 2 });
      await agent.init(makeInitContext()); // turn 0 (initial)
      expect(agent.getStatus()).toBe('waiting_for_user');

      await agent.onUserInput('turn 1'); // turn 1 < maxTurns (2)
      expect(agent.getStatus()).toBe('waiting_for_user');

      await agent.onUserInput('turn 2'); // turn 2 >= maxTurns (2) → auto-finalize
      expect(agent.getStatus()).toBe('completed');
      // dispatchTask should have been called twice (once for init, once for turn 1)
      expect(harness.dispatchTask).toHaveBeenCalledTimes(2);
    });

    it('sets status to error when dispatch fails', async () => {
      harness.dispatchTask = vi
        .fn()
        .mockResolvedValueOnce(makeCompletedResult()) // init succeeds
        .mockRejectedValueOnce(new Error('Timeout')); // user input fails

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      await agent.onUserInput('do something');
      expect(agent.getStatus()).toBe('error');
    });

    it('handles task result with error status', async () => {
      harness.dispatchTask = vi
        .fn()
        .mockResolvedValueOnce(makeCompletedResult())
        .mockResolvedValueOnce(makeFailedResult({ error: 'Execution failed' }));

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      await agent.onUserInput('do something');
      expect(agent.getStatus()).toBe('error');
    });
  });

  describe('finalize()', () => {
    it('returns a deliverable with transcript', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext({ message: 'hello' }));

      const deliverable = await agent.finalize();
      expect(deliverable.type).toBe('external_agent_chat');
      expect((deliverable.content as any).agentId).toBe('test-agent');
      expect((deliverable.content as any).turns).toBe(2);
      expect((deliverable.content as any).transcript).toContain('[user] hello');
      expect((deliverable.content as any).transcript).toContain('[agent] Hello! How can I help?');
    });

    it('sets status to completed', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      await agent.finalize();
      expect(agent.getStatus()).toBe('completed');
    });

    it('emits completed event', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const events: AgentEvent[] = [];
      const agent = new InteractiveExternalAgent(options);
      agent.onEvent.on('event', (e) => events.push(e));

      await agent.init(makeInitContext());
      const deliverable = await agent.finalize();

      const completedEvents = events.filter((e) => e.type === 'completed');
      expect(completedEvents.length).toBe(1);
    });
  });

  describe('getStatus()', () => {
    it('returns waiting_for_user initially', () => {
      const agent = new InteractiveExternalAgent(options);
      expect(agent.getStatus()).toBe('waiting_for_user');
    });

    it('returns running during init', async () => {
      harness.dispatchTask = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves

      const agent = new InteractiveExternalAgent(options);
      const initPromise = agent.init(makeInitContext());
      expect(agent.getStatus()).toBe('running');
      // teardown
    });
  });

  describe('getChatHistory()', () => {
    it('returns a copy of the history', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext());

      const history = agent.getChatHistory();
      history.push({ role: 'user', content: 'injected', timestamp: new Date().toISOString() });
      expect(agent.getChatHistory().length).toBe(2); // original unchanged
    });
  });

  describe('getCurrentTarget()', () => {
    it('returns the original agentId by default', () => {
      const agent = new InteractiveExternalAgent(options);
      expect(agent.getCurrentTarget()).toBe('test-agent');
    });
  });

  describe('Squad routing', () => {
    it('routes to squad member when @mention is in message', async () => {
      const router = makeSquadRouter({
        route: vi.fn().mockReturnValue({ targetAgentId: 'team-member-1', strategy: 'round-robin' }),
      });
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent({ ...options, squadRouter: router });
      await agent.init(makeInitContext({ message: '@team help' }));

      expect(router.route).toHaveBeenCalled();
      expect(agent.getCurrentTarget()).toBe('team-member-1');
    });

    it('does not route when no squad router is configured', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext({ message: '@team help' }));

      expect(agent.getCurrentTarget()).toBe('test-agent'); // unchanged
    });

    it('falls back to original target when squad routing fails', async () => {
      const router = makeSquadRouter({
        route: vi.fn().mockReturnValue(null),
      });
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent({ ...options, squadRouter: router });
      await agent.init(makeInitContext({ message: '@unknown help' }));

      expect(agent.getCurrentTarget()).toBe('test-agent'); // unchanged
    });

    it('does not re-route when target is the same', async () => {
      const router = makeSquadRouter({
        route: vi.fn().mockReturnValue({ targetAgentId: 'test-agent', strategy: 'round-robin' }),
      });
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent({ ...options, squadRouter: router });
      await agent.init(makeInitContext({ message: '@test-agent hello' }));

      // currentTargetAgentId stays the same, so no re-routing thinking event
      expect(agent.getCurrentTarget()).toBe('test-agent');
    });
  });

  describe('Event emission', () => {
    it('emits thinking events during dispatch', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const events: AgentEvent[] = [];
      const agent = new InteractiveExternalAgent(options);
      agent.onEvent.on('event', (e) => events.push(e));

      await agent.init(makeInitContext());

      const thinkingEvents = events.filter((e) => e.type === 'thinking');
      expect(thinkingEvents.length).toBeGreaterThanOrEqual(1);
      expect(thinkingEvents[0].type).toBe('thinking');
    });

    it('emits output event on completed result', async () => {
      harness.dispatchTask = vi
        .fn()
        .mockResolvedValue(makeCompletedResult({ output: 'Analysis complete' }));

      const events: AgentEvent[] = [];
      const agent = new InteractiveExternalAgent(options);
      agent.onEvent.on('event', (e) => events.push(e));

      await agent.init(makeInitContext());

      const outputEvents = events.filter((e) => e.type === 'output') as any[];
      expect(outputEvents.length).toBe(1);
      expect(outputEvents[0].content).toBe('Analysis complete');
    });

    it('emits error event on task failure', async () => {
      harness.dispatchTask = vi.fn().mockRejectedValue(new Error('Network error'));

      const events: AgentEvent[] = [];
      const agent = new InteractiveExternalAgent(options);
      agent.onEvent.on('event', (e) => events.push(e));

      await agent.init(makeInitContext());

      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('does not crash when event listener throws', async () => {
      harness.dispatchTask = vi.fn().mockResolvedValue(makeCompletedResult());

      const agent = new InteractiveExternalAgent(options);
      agent.onEvent.on('event', () => {
        throw new Error('listener error');
      });

      await expect(agent.init(makeInitContext())).resolves.toBeUndefined();
    });
  });

  describe('buildTask', () => {
    it('includes conversation history in dispatched task', async () => {
      let capturedTask: ExternalTask | undefined;
      harness.dispatchTask = vi.fn().mockImplementation((task: ExternalTask) => {
        capturedTask = task;
        return Promise.resolve(makeCompletedResult());
      });

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext({ message: 'first message' }));
      await agent.onUserInput('second message');

      expect(capturedTask).toBeDefined();
      expect(capturedTask!.input).toContain('second message');
      expect(capturedTask!.input).toContain('Conversation History');
      expect(capturedTask!.input).toContain('[user]: first message');
    });

    it('sets project context from init context', async () => {
      let capturedTask: ExternalTask | undefined;
      harness.dispatchTask = vi.fn().mockImplementation((task: ExternalTask) => {
        capturedTask = task;
        return Promise.resolve(makeCompletedResult());
      });

      const agent = new InteractiveExternalAgent(options);
      await agent.init(makeInitContext({ projectId: 'my-project', message: 'hello' }));

      expect(capturedTask).toBeDefined();
      expect(capturedTask!.slot.project.name).toBe('my-project');
    });
  });
});
