// ── activeSubAgents (defined here, re-exported by shell) ──
export const activeSubAgents = new Map<
  string,
  {
    loop: import('@cabinet/agent').AgentLoop;
    interactive?: import('@cabinet/agent').InteractiveSubAgent;
    parentSessionId: string;
    roleType: string;
    status: 'running' | 'waiting_for_user' | 'completed' | 'error';
  }
>();
