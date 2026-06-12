import './context/build-context.js';

export type { ServerContext, SystemMode } from './context/types.js';
export {
  getServerContext,
  getCurrentTier,
  setCurrentTier,
  onTierChange,
  getSystemMode,
  setSystemMode,
  onSystemModeChange,
} from './context/state.js';
export { activeApiKeyId, setActiveApiKeyId, getActiveApiKeyId } from './context/api-keys.js';
export { type RecentFileEntry, FileAccessTracker, TaskTracker } from './context/trackers.js';
