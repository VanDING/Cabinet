import { describe, it, expect } from 'vitest';

describe('UI Components', () => {
  it('DecisionCard export exists', async () => {
    const mod = await import('../decision-card.js');
    expect(mod.DecisionCard).toBeDefined();
  });

  it('SecretaryChat export exists', async () => {
    const mod = await import('../secretary-chat.js');
    expect(mod.SecretaryChat).toBeDefined();
  });

  it('SubAgentCard export exists', async () => {
    const mod = await import('../sub-agent-card.js');
    expect(mod.SubAgentCard).toBeDefined();
  });

  it('DashboardSummary export exists', async () => {
    const mod = await import('../dashboard-summary.js');
    expect(mod.DashboardSummary).toBeDefined();
  });

  it('Navigation export exists', async () => {
    const mod = await import('../navigation.js');
    expect(mod.Navigation).toBeDefined();
  });
});
