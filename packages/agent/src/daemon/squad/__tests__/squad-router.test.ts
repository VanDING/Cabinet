import { describe, it, expect, vi } from 'vitest';
import { SquadRouter } from '../squad-router.js';

function createMockRepo(overrides: Record<string, any> = {}) {
  return {
    findById: vi.fn(),
    findActiveMembers: vi.fn(),
    findMembers: vi.fn(),
    advanceRoundRobin: vi.fn(),
    ...overrides,
  };
}

describe('SquadRouter', () => {
  describe('strategy: leader_decision', () => {
    it('returns leader agent ID', () => {
      const repo = createMockRepo({
        findById: () => ({
          id: 'squad-1',
          name: 'Test Squad',
          enabled: true,
          routing_strategy: 'leader_decision',
          leader_agent_id: 'leader-1',
          fallback_agent_id: null,
        }),
        findActiveMembers: () => [
          { agent_id: 'member-1', priority: 1, skills_json: '[]', max_concurrent_tasks: 3 },
        ],
      });
      const router = new SquadRouter(repo as any);
      const result = router.route('squad-1', 'do something');
      expect(result).not.toBeNull();
      expect(result!.targetAgentId).toBe('leader-1');
      expect(result!.strategy).toBe('leader_decision');
    });
  });

  describe('strategy: round_robin', () => {
    it('cycles through members using advanceRoundRobin', () => {
      const repo = createMockRepo({
        findById: () => ({
          id: 'squad-1',
          enabled: true,
          routing_strategy: 'round_robin',
          leader_agent_id: null,
          fallback_agent_id: null,
        }),
        findActiveMembers: () => [
          { agent_id: 'member-1', priority: 1, skills_json: '[]', max_concurrent_tasks: 3 },
          { agent_id: 'member-2', priority: 1, skills_json: '[]', max_concurrent_tasks: 3 },
        ],
        advanceRoundRobin: () => 1,
      });
      const router = new SquadRouter(repo as any);
      const result = router.route('squad-1', 'task');
      expect(result).not.toBeNull();
      expect(result!.targetAgentId).toBe('member-2');
      expect(result!.strategy).toBe('round_robin');
    });
  });

  describe('strategy: skill_match', () => {
    it('picks best matching member by skills', () => {
      const repo = createMockRepo({
        findById: () => ({
          id: 'squad-1',
          enabled: true,
          routing_strategy: 'skill_match',
          leader_agent_id: null,
          fallback_agent_id: null,
        }),
        findActiveMembers: () => [
          {
            agent_id: 'member-1',
            priority: 0,
            skills_json: '["python", "backend"]',
            max_concurrent_tasks: 3,
          },
          {
            agent_id: 'member-2',
            priority: 0,
            skills_json: '["react", "frontend"]',
            max_concurrent_tasks: 3,
          },
        ],
      });
      const router = new SquadRouter(repo as any);
      const result = router.route('squad-1', 'write a Python script');
      expect(result!.targetAgentId).toBe('member-1');
    });
  });

  describe('strategy: auto', () => {
    it('balances skill match with load', () => {
      const repo = createMockRepo({
        findById: () => ({
          id: 'squad-1',
          enabled: true,
          routing_strategy: 'auto',
          leader_agent_id: null,
          fallback_agent_id: null,
        }),
        findActiveMembers: () => [
          {
            agent_id: 'busy-member',
            priority: 0,
            skills_json: '["python"]',
            max_concurrent_tasks: 1,
          },
          {
            agent_id: 'free-member',
            priority: 0,
            skills_json: '["python"]',
            max_concurrent_tasks: 3,
          },
        ],
      });
      const router = new SquadRouter(repo as any);
      const loadMap = new Map<string, number>([
        ['busy-member', 1],
        ['free-member', 0],
      ]);
      const result = router.route('squad-1', 'python task', loadMap);
      expect(result!.targetAgentId).toBe('free-member');
    });
  });

  it('returns null for disabled squad', () => {
    const repo = createMockRepo({
      findById: () => ({ id: 'squad-1', enabled: false }),
    });
    const router = new SquadRouter(repo as any);
    expect(router.route('squad-1', 'task')).toBeNull();
  });

  it('returns null when squad not found', () => {
    const repo = createMockRepo({ findById: () => null });
    const router = new SquadRouter(repo as any);
    expect(router.route('nonexistent', 'task')).toBeNull();
  });

  it('uses fallback agent when no members are active', () => {
    const repo = createMockRepo({
      findById: () => ({
        id: 'squad-1',
        enabled: true,
        routing_strategy: 'auto',
        leader_agent_id: null,
        fallback_agent_id: 'fallback-1',
      }),
      findActiveMembers: () => [],
    });
    const router = new SquadRouter(repo as any);
    const result = router.route('squad-1', 'task');
    expect(result!.targetAgentId).toBe('fallback-1');
    expect(result!.strategy).toBe('fallback');
  });
});
