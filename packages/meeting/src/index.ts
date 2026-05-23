// @cabinet/meeting — Meeting protocol (pure logic, no I/O)
//
// Exports prompt builders and response parsers for the 4-phase meeting protocol.
// The server layer handles LLM calls, DB writes, and WebSocket broadcasts.

export {
  buildChairPrompt,
  parseChairResponse,
  buildAdvisorPrompt,
  parseAdvisorResponse,
  buildReviewerTask,
  parseReviewerResponse,
  buildExtractionPrompt,
  parseExtractionResponse,
  type PerspectiveDef,
  type AnalysisBrief,
  type AdvisorFinding,
  type AdvisorResult,
  type ReviewIssue,
  type ReviewResult,
  type ExtractionResult,
} from './protocol.js';

export {
  generateSynthesis,
  type SynthesisInput,
} from './synthesis.js';
