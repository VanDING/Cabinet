import { DEFAULT_DELEGATION_TIER, type DelegationTier } from '@cabinet/types';
import type { ServerContext, SystemMode } from './types.js';

let systemMode: SystemMode = 'normal';
const modeChangeListeners: Array<(mode: SystemMode) => void> = [];

export function getSystemMode(): SystemMode {
  return systemMode;
}

export function setSystemMode(mode: SystemMode): void {
  systemMode = mode;
  if (ctx) {
    (ctx as any).systemMode = mode;
  }
  for (const listener of modeChangeListeners) {
    try {
      listener(mode);
    } catch {
      /* non-fatal */
    }
  }
}

export function onSystemModeChange(fn: (mode: SystemMode) => void): void {
  modeChangeListeners.push(fn);
}

let ctx: ServerContext | null = null;
let currentTier: DelegationTier = DEFAULT_DELEGATION_TIER;
const tierChangeListeners: Array<(tier: DelegationTier) => void> = [];

export function getCurrentTier(): DelegationTier {
  return currentTier;
}

export function setCurrentTier(tier: DelegationTier): void {
  currentTier = tier;
  if (ctx) {
    ctx.delegationTier = tier;
  }
  for (const listener of tierChangeListeners) {
    try {
      listener(tier);
    } catch {
      /* non-fatal */
    }
  }
}

/** Register a callback invoked whenever the delegation tier changes. */
export function onTierChange(fn: (tier: DelegationTier) => void): void {
  tierChangeListeners.push(fn);
}

export function getServerContext(): ServerContext {
  if (!ctx) {
    ctx = buildServerContext();
  }
  return ctx;
}

export function setServerContext(newCtx: ServerContext | null): void {
  ctx = newCtx;
}

// Forward declaration — implemented in build-context.ts
let buildServerContext: () => ServerContext;
export function registerBuildServerContext(fn: () => ServerContext): void {
  buildServerContext = fn;
}
