import type { LLMGateway } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import type { TrustLevel, DelegationTier } from '@cabinet/types';
import type { ToolExecutor } from '../tool-executor.js';
import type { SafetyChecker } from '../safety.js';
import type { CheckpointManager } from '../checkpoint.js';
import type { MemoryProvider, PrebuiltContext } from '../context-builder.js';
import type { RulesLoader } from '../rules-loader.js';
import type { ToolPruner } from '../tool-pruner.js';
import type { PromptModules } from '../prompt-assembler.js';
import type { StepEventConfig } from '../observers/step-event-observer.js';
import type { PISObserverConfig } from '../observers/process-identity-observer.js';
import type { AdaptiveThresholdConfig } from '../context-monitor-adaptive.js';
import type { SessionMetricsRepository } from '@cabinet/storage';
import type Database from 'better-sqlite3';
import type { AgentBlackboard } from '../blackboard.js';
import type { ContentFilterConfig } from '../guard/content-filter.js';
import type { AutoReplanConfig } from '../observers/auto-replan.js';
import type { SelfConsistencyConfig } from '../reasoning/self-consistency.js';
import type { ReflectionConfig } from '../observers/reflection.js';
import type { JudgeConfig } from '../observers/judge.js';

export interface AgentSessionSummary {
  sessionId: string;
  projectId: string;
  captainId: string;
  model: string;
  totalSteps: number;
  totalTokens: { prompt: number; completion: number };
  toolCalls: { total: number; succeeded: number; failed: number; blocked: number };
  contextZones: { smart: number; warning: number; critical: number; dumb: number };
  contextHandoffs: number;
  errors: { transient: number; recoverable: number; fatal: number };
  durationMs: number;
  success: boolean;
  startTime: string;
  /** Detailed tool call history for skill extraction and debugging. */
  toolCallHistory?: { name: string; args: Record<string, unknown>; result: unknown }[];
}

export type SessionCompleteCallback = (summary: AgentSessionSummary) => void;

export const TRUST_THRESHOLDS: Record<
  TrustLevel,
  { maxConsecutiveErrors: number; maxProbeTools: number }
> = {
  T0: { maxConsecutiveErrors: 2, maxProbeTools: 3 },
  T1: { maxConsecutiveErrors: 3, maxProbeTools: 5 },
  T2: { maxConsecutiveErrors: 5, maxProbeTools: 10 },
  T3: { maxConsecutiveErrors: 10, maxProbeTools: Infinity },
};

export interface AgentLoopOptions {
  gateway: LLMGateway;
  toolExecutor: ToolExecutor;
  safetyChecker: SafetyChecker;
  checkpointManager: CheckpointManager;
  memoryProvider: MemoryProvider;
  sessionId: string;
  projectId: string;
  captainId: string;
  systemPrompt?: string;
  maxSteps?: number;
  eventBus?: EventBus;
  model?: string;
  activeFiles?: string[];
  taskDescription?: string;
  /** Timeout for individual tool execution in ms (default 300000 = 5 min). */
  toolTimeoutMs?: number;
  /** Session ID used for memory lookups (defaults to sessionId if omitted). */
  memorySessionId?: string;
  /** Called when the agent session completes (success or failure). */
  onSessionComplete?: SessionCompleteCallback;
  /** Max output tokens for LLM calls (undefined = model default). */
  maxResponseTokens?: number;
  /** Temperature for LLM calls (undefined = model default). */
  temperature?: number;
  /** Context window budget as fraction of model window (0-1, default 0.4 = 40%). */
  contextBudget?: number;
  /** Anthropic extended thinking budget in tokens (1024–128000). */
  thinkingBudget?: number;
  /** Project root directory for snapshot caching (defaults to process.cwd()). */
  projectRoot?: string;
  /** Optional rules loader for hierarchical rule injection. */
  rulesLoader?: RulesLoader;
  /** Optional cost tracker for per-LLM-call cost recording. */
  costTracker?: {
    record(
      model: string,
      promptTokens: number,
      completionTokens: number,
      cachedPromptTokens?: number,
    ): void;
  };
  /** Pre-built context for strict consistency (skips self-collection in ContextBuilder). */
  prebuiltContext?: PrebuiltContext;
  /** User-configurable trust level (T0-T3) for error tolerance and tool limits. */
  trustLevel?: TrustLevel;
  /** Optional dynamic tool pruner — reduces exposed tools per-turn by task relevance. */
  toolPruner?: ToolPruner;
  /** Role modules for modular prompt assembly (preferred over systemPrompt). */
  roleModules?: PromptModules;
  /** SQLite database for step-event recording (4.0). */
  db?: Database.Database;
  /** Step event observer config (4.0). */
  stepEvents?: StepEventConfig;
  /** Adaptive threshold monitor config (4.1). */
  adaptiveMonitor?: AdaptiveThresholdConfig & { metricsRepo?: SessionMetricsRepository };
  /** Process Identity Score config (4.3). */
  pis?: PISObserverConfig;
  /** Agent Blackboard for shared state injection (4.2). */
  blackboard?: AgentBlackboard;
  /** MCP resource metadata for system prompt injection (4.4). */
  mcpResources?: Array<{ uri: string; name: string; description?: string }>;
  /** MCP prompt metadata for system prompt injection (4.4). */
  mcpPrompts?: Array<{ name: string; description?: string }>;
  /** Content guardrails config (P0-2). */
  guardrails?: ContentFilterConfig;
  /** Reflection config (P0-1). */
  reflection?: ReflectionConfig;
  /** Judge config (P0-3). */
  judge?: JudgeConfig;
  /** Auto-replan config (P1-5). */
  autoReplan?: AutoReplanConfig;
  /** Self-consistency config (P1-6). Engine exposed via getSelfConsistencyEngine(). */
  selfConsistency?: SelfConsistencyConfig;
  /** Observer pipeline preset: minimal | standard | enhanced | full (default: standard). */
  observerPreset?: import('./observer-presets.js').ObserverPresetName;
}

export interface AgentResult {
  content: string;
  steps: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
  usage?: { promptTokens: number; completionTokens: number };
  /** Parsed structured output if the agent emitted a JSON block. */
  structuredOutput?: import('@cabinet/types').AgentOutput;
}
