import type { AgentLoop } from '@cabinet/agent';
import type { SecretaryAgent } from '@cabinet/secretary';

// ── Multi-agent cache (keyed by sessionId:roleType) ──
export const agentLoopCache = new Map<string, AgentLoop>();
export const MAX_CACHE_SIZE = 100;

// Per-session secretary agents (keyed by sessionId)
export const secretaryAgentCache = new Map<string, SecretaryAgent>();
export const secretaryAgentLoopCache = new Map<string, AgentLoop>();

// Reviewer AgentLoop cache (keyed by delegation tier)
export const reviewerLoopCache = new Map<string, AgentLoop>();
export const REVIEWER_CACHE_SIZE = 20;

// Per-session trust level overrides (detected from natural language)
export const sessionTrustLevel = new Map<string, import('@cabinet/agent').TrustLevel>();

export function detectTrustLevelOverride(msg: string): import('@cabinet/agent').TrustLevel | null {
  const lower = msg.toLowerCase();
  if (
    lower.includes('允许你多尝试几次') ||
    lower.includes('放手去做') ||
    lower.includes('大胆尝试')
  )
    return 'T2';
  if (lower.includes('谨慎处理') || lower.includes('不要擅自') || lower.includes('小心'))
    return 'T0';
  if (lower.includes('完全信任') || lower.includes('调试模式') || lower.includes('debug'))
    return 'T3';
  return null;
}

// Lazy reference to dispatchToSpecialistStreaming — avoids circular import with dispatch.ts
let _dispatchToSpecialistStreaming: ((...args: any[]) => any) | undefined;

export function _setDispatchStreamingRef(fn: typeof _dispatchToSpecialistStreaming) {
  _dispatchToSpecialistStreaming = fn;
}

export function getDispatchStreaming() {
  return _dispatchToSpecialistStreaming;
}
