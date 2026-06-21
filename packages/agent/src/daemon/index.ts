//
// Agent Daemon — barrel export
//

export { AgentDaemon, type AgentDaemonOptions } from './agent-daemon.js';
export { TaskQueuePoller } from './task-queue-poller.js';
export { WorkspaceManager, type WorkspaceManagerConfig } from './workspace-manager.js';
export type { DiscoveryResult } from '../discovery/scanner.js';
export { WSDaemonClient, type WSDaemonClientConfig, type WSCtor } from './ws-daemon-client.js';
export {
  InteractiveExternalAgent,
  type InteractiveExternalAgentOptions,
  type SquadRouterLike,
  type ChatTurn,
  type SquadRouteMatch,
} from './interactive-external-agent.js';
