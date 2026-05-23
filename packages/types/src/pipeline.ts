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
}
