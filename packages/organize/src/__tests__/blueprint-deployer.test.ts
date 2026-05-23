import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlueprintDeployer, type DeployerDependencies, type DeployResult } from '../blueprint-deployer.js';
import type { Blueprint } from '@cabinet/types';
import type { EventBus } from '@cabinet/events';

function mockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getCausationChain: vi.fn().mockResolvedValue([]),
    once: vi.fn(),
    replay: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };
}

function mockDeps(overrides?: Partial<DeployerDependencies>): DeployerDependencies {
  return {
    registerAgent: vi.fn().mockReturnValue({ type: 'custom', name: 'TestAgent' }),
    listAgents: vi.fn().mockReturnValue([]),
    createWorkflow: vi.fn().mockReturnValue({ id: 'wf-1' }),
    runWorkflow: vi.fn().mockResolvedValue({ runId: 'run-1', status: 'completed' }),
    eventBus: mockEventBus(),
    projectId: 'test-project',
    ...overrides,
  };
}

describe('BlueprintDeployer', () => {
  let deps: DeployerDependencies;
  let deployer: BlueprintDeployer;

  beforeEach(() => {
    deps = mockDeps();
    deployer = new BlueprintDeployer(deps);
  });

  it('registers agents with action create_new', async () => {
    const bp: Blueprint = {
      agents: [{ action: 'create_new', name: 'NewAgent', prompt: 'Do work' }],
    };
    const result = await deployer.deploy(bp);
    expect(deps.registerAgent).toHaveBeenCalledTimes(1);
    expect(result.agentsCreated).toContain('TestAgent');
    expect(result.agentsReused).toHaveLength(0);
  });

  it('skips agents with action use_existing', async () => {
    const bp: Blueprint = {
      agents: [{ action: 'use_existing', name: 'ExistingAgent' }],
    };
    const result = await deployer.deploy(bp);
    expect(deps.registerAgent).not.toHaveBeenCalled();
    expect(result.agentsReused).toContain('ExistingAgent');
  });

  it('creates workflow from blueprint steps', async () => {
    const bp: Blueprint = {
      meta: { goal: 'Test workflow' },
      workflow: { steps: [{ id: 's1', type: 'aiAgent' }] },
    };
    const result = await deployer.deploy(bp);
    expect(deps.createWorkflow).toHaveBeenCalledTimes(1);
    expect(result.workflowId).toBe('wf-1');
  });

  it('runs workflow after creation', async () => {
    const bp: Blueprint = {
      workflow: { steps: [{ id: 's1' }] },
    };
    const result = await deployer.deploy(bp);
    expect(deps.runWorkflow).toHaveBeenCalledWith('wf-1');
    expect(result.runId).toBe('run-1');
  });

  it('publishes deployment event on success', async () => {
    const bp: Blueprint = {
      agents: [{ action: 'create_new', name: 'Test' }],
    };
    await deployer.deploy(bp);
    expect(deps.eventBus.publish).toHaveBeenCalled();
    const callArgs = (deps.eventBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect((callArgs?.payload as any)?.data?.success).toBe(true);
  });

  it('records agent registration failure gracefully', async () => {
    const failingDeps = mockDeps({
      registerAgent: vi.fn().mockImplementation(() => {
        throw new Error('Registration failed');
      }),
    });
    deployer = new BlueprintDeployer(failingDeps);
    const bp: Blueprint = {
      agents: [{ action: 'create_new', name: 'BadAgent' }],
    };
    const result = await deployer.deploy(bp);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.phase).toBe('agent_registration');
    expect(result.success).toBe(false);
  });

  it('records workflow creation failure gracefully', async () => {
    const failingDeps = mockDeps({
      createWorkflow: vi.fn().mockImplementation(() => {
        throw new Error('Creation failed');
      }),
    });
    deployer = new BlueprintDeployer(failingDeps);
    const bp: Blueprint = {
      workflow: { steps: [{ id: 's1' }] },
    };
    const result = await deployer.deploy(bp);
    expect(result.errors.some((e) => e.phase === 'workflow_creation')).toBe(true);
  });

  it('records workflow execution failure gracefully', async () => {
    const failingDeps = mockDeps({
      runWorkflow: vi.fn().mockRejectedValue(new Error('Run failed')),
    });
    deployer = new BlueprintDeployer(failingDeps);
    const bp: Blueprint = {
      workflow: { steps: [{ id: 's1' }] },
    };
    const result = await deployer.deploy(bp);
    expect(result.errors.some((e) => e.phase === 'workflow_execution')).toBe(true);
  });

  it('empty blueprint deploys without errors', async () => {
    const result = await deployer.deploy({});
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.agentsCreated).toHaveLength(0);
    expect(result.workflowId).toBeNull();
  });

  it('handles mixed agents (create_new + use_existing)', async () => {
    const bp: Blueprint = {
      agents: [
        { action: 'create_new', name: 'NewOne' },
        { action: 'use_existing', name: 'OldOne' },
      ],
    };
    const result = await deployer.deploy(bp);
    expect(result.agentsCreated).toContain('TestAgent');
    expect(result.agentsReused).toContain('OldOne');
  });
});
