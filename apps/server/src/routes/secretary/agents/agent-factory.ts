// Agent factory — re-export shell.
// Implementation moved to agents/agent-factory/*.ts sub-modules.

export {
  agentLoopCache,
  secretaryAgentCache,
  secretaryAgentLoopCache,
  reviewerLoopCache,
  sessionTrustLevel,
  detectTrustLevelOverride,
  _setDispatchStreamingRef,
} from './agent-factory/shared.js';

export { buildRulesLoader } from './agent-factory/rules.js';
export { resolveModel } from './agent-factory/model.js';
export { getAgentLoopForRole, createReviewerLoop } from './agent-factory/loops.js';
export { persistReviewResult } from './agent-factory/review.js';
export { getOrCreateAgent } from './agent-factory/secretary.js';
