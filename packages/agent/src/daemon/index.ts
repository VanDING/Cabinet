//
// Agent Daemon — barrel export
//

export { AgentDaemon, type AgentDaemonOptions } from './agent-daemon.js';
export { TaskQueuePoller } from './task-queue-poller.js';
export { WorkspaceManager, type WorkspaceManagerConfig } from './workspace-manager.js';
export { AutoDiscoverer, type DiscoveryResult, type KnownCliAgent } from './auto-discoverer.js';
export { WSDaemonClient, type WSDaemonClientConfig, type WSCtor } from './ws-daemon-client.js';
