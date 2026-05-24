// ── Agent Dispatcher pipeline types ──

export type DispatchMode = 'pipeline' | 'parallel' | 'single';

export interface PipelineStep {
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: string;
  output?: string;
  error?: string;
  durationMs: number;
  steps: number;
  /** Structured parsed output from the agent, if available. */
  structuredOutput?: import('./agent-output.js').AgentOutput;
}
