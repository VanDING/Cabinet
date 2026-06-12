// Agent dispatch — re-export shell.
// Implementation moved to agents/dispatch/*.ts sub-modules.

export { activeSubAgents } from './dispatch/state.js';
export {
  dispatchToExternalAgent,
  buildContextSlot,
  adapterCache,
  getOrCreateAdapter,
} from './dispatch/external.js';
export { dispatchToSpecialist } from './dispatch/specialist.js';
export { dispatchToSpecialistStreaming } from './dispatch/streaming.js';
