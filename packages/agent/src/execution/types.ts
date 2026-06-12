/** Callback for streaming LLM output chunk by chunk. */
export interface StreamingCallback {
  onChunk(content: string): void;
  onRoutingStart?(targetAgent: string): void;
  onToolCall?(name: string, args: Record<string, unknown>): void;
  onToolResult?(name: string, result: unknown): void;
  onThinking?(content: string): void;
  onThinkingDone?(): void;
  onUsage?(usage: { promptTokens: number; completionTokens: number }): void;
  onTaskUpdate?(tasks: import('../task-tracker.js').AgentTask[]): void;
  onSemanticTaskUpdate?(tasks: import('../task-tracker.js').SemanticTask[]): void;
  onStepBudgetWarning?(remaining: number, maxSteps: number): void;
  // Sub-agent orchestration events
  onSubAgentStart?(agentName: string, taskDescription: string): void;
  onSubAgentToolCall?(agentName: string, toolName: string, args: Record<string, unknown>): void;
  onSubAgentThinking?(agentName: string, content: string): void;
  onSubAgentDone?(agentName: string, result: string): void;
  onSubAgentError?(agentName: string, error: string): void;
  onQualityReview?(result: { pass: boolean; score: number; issues: any[] }): void;
  onDone(fullContent: string): void;
  onError?(error: string): void;
}
