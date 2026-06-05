// Agent factory, dispatch, and meeting — re-export shell.
// Implementation moved to agents/*.ts sub-modules (Phase 3 split).

import { runMeeting } from './agents/meeting.js';
import { _setRunMeetingRef, _setDispatchStreamingRef } from './agents/agent-factory.js';
import { dispatchToSpecialistStreaming } from './agents/dispatch.js';

// Wire lazy cross-module references (avoids circular imports)
_setRunMeetingRef(runMeeting);
_setDispatchStreamingRef(dispatchToSpecialistStreaming);

// ── Re-exports from sub-modules ──

// activeSubAgents lives in dispatch (its primary user)
export { activeSubAgents } from './agents/dispatch.js';

// Meeting
export {
  meetingResultStore,
  capturedMeetingResult,
  runMeeting,
} from './agents/meeting.js';
export type { MeetingResult } from './agents/meeting.js';

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
