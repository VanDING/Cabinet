import type { Hono } from 'hono';
import { getServerContext, getCurrentTier, setCurrentTier } from '../../context.js';
import { DelegationTier } from '@cabinet/types';
import { saveSettings } from './persistence.js';

const TIER_DESCRIPTIONS: Record<string, string> = {
  [DelegationTier.CaptainReview]:
    'Every write operation and decision requires your confirmation. Recommended for initial setup and audit periods.',
  [DelegationTier.StrategicGuard]:
    'Low-risk operations are automatic. Cost-incurring actions (meetings, workflow runs) and destructive changes require confirmation.',
  [DelegationTier.TrustedMode]:
    'Most operations are automatic. Only destructive changes (deletion, decision rejection) require confirmation.',
  [DelegationTier.FullAutonomy]:
    'Full autonomy. The budget cap is the only gate. A daily summary will keep you informed.',
};

const ALL_TIERS = [
  DelegationTier.CaptainReview,
  DelegationTier.StrategicGuard,
  DelegationTier.TrustedMode,
  DelegationTier.FullAutonomy,
];

export function registerDelegationTierRoutes(router: Hono): void {
  router.get('/delegation-tier', (c) => {
    const tier = getCurrentTier();
    return c.json({
      tier,
      label: tier
        .replace('T0', 'Captain Review')
        .replace('T1', 'Strategic Guard')
        .replace('T2', 'Trusted Mode')
        .replace('T3', 'Full Autonomy'),
      description: TIER_DESCRIPTIONS[tier] ?? '',
      available: ALL_TIERS.map((t) => ({
        id: t,
        label:
          t === 'T0'
            ? 'Captain Review'
            : t === 'T1'
              ? 'Strategic Guard'
              : t === 'T2'
                ? 'Trusted Mode'
                : 'Full Autonomy',
        description: TIER_DESCRIPTIONS[t] ?? '',
      })),
    });
  });

  router.put('/delegation-tier', async (c) => {
    const body = await c.req.json();
    const tier = body.tier as string;
    if (!ALL_TIERS.includes(tier as DelegationTier)) {
      return c.json({ error: `Invalid tier. Must be one of: ${ALL_TIERS.join(', ')}` }, 400);
    }
    setCurrentTier(tier as DelegationTier);
    saveSettings({ delegationTier: tier });
    const { logger } = getServerContext();
    logger.info('Delegation tier changed', { tier });
    return c.json({ tier, status: 'updated' });
  });
}
