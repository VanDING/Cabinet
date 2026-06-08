// Agent factory, dispatch — re-export shell.
// Implementation moved to agents/*.ts sub-modules (Phase 3 split).

import { _setDispatchStreamingRef } from './agents/agent-factory.js';
import { dispatchToSpecialistStreaming } from './agents/dispatch.js';

// Wire lazy cross-module references (avoids circular imports)
_setDispatchStreamingRef(dispatchToSpecialistStreaming);

// ── Re-exports from sub-modules ──

// activeSubAgents lives in dispatch (its primary user)
export { activeSubAgents } from './agents/dispatch.js';

// Feedback
export {
  routeFeedbackStore,
  feedbackStoreLoaded,
  loadFeedbackStore,
  feedbackStore,
} from './agents/feedback.js';

// Agent Factory
export {
  agentLoopCache,
  secretaryAgentCache,
  secretaryAgentLoopCache,
  reviewerLoopCache,
  sessionTrustLevel,
  detectTrustLevelOverride,
  buildRulesLoader,
  resolveModel,
  getAgentLoopForRole,
  createReviewerLoop,
  persistReviewResult,
  getOrCreateAgent,
} from './agents/agent-factory.js';

// Dispatch
export {
  dispatchToExternalAgent,
  buildContextSlot,
  adapterCache,
  getOrCreateAdapter,
  dispatchToSpecialist,
  dispatchToSpecialistStreaming,
} from './agents/dispatch.js';
