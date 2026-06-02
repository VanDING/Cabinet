import type Database from 'better-sqlite3';
import type { LLMGateway } from '@cabinet/gateway';
import { AgentLoop, type AgentResult } from './agent-loop.js';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { CheckpointManager } from './checkpoint.js';
import type { MemoryProvider } from './context-builder.js';
import type { AgentRole } from './agent-roles.js';
import { buildHandoffFromResult, buildSimpleHandoff, type AgentHandoff } from './agent-handoff.js';
import { END } from '@cabinet/graph';

export type { AgentHandoff };

export interface AgentNodeDeps {
  gateway: LLMGateway;
  toolExecutor: ToolExecutor;
  safetyChecker: SafetyChecker;
  db: Database.Database;
  memoryProvider: MemoryProvider;
}

export interface AgentNodeConfig<S> {
  role: AgentRole;
  agentId: string;
  input: (state: S) => { message: string; systemPrompt?: string };
  output?: (state: S, result: AgentResult) => Partial<S>;
}

export type AgentNodeFn<S> = (state: S) => Promise<Partial<S>>;

export function createAgentNodeFactory<S>(deps: AgentNodeDeps) {
  return function createAgentNode(config: AgentNodeConfig<S>): AgentNodeFn<S> {
    return async (state: S) => {
      const { message, systemPrompt: override } = config.input(state);

      const systemPrompt = override
        ? `${config.role.systemPrompt}\n\n${override}`
        : config.role.systemPrompt;

      const toolView = deps.toolExecutor.createView(config.role.allowedTools);

      const loop = new AgentLoop({
        gateway: deps.gateway,
        toolExecutor: toolView,
        safetyChecker: deps.safetyChecker,
        checkpointManager: new CheckpointManager(deps.db),
        memoryProvider: deps.memoryProvider,
        sessionId: `${config.agentId}_${Date.now()}`,
        projectId: '',
        captainId: '',
        systemPrompt,
        model: config.role.modelTier,
        maxSteps: config.role.maxSteps ?? 50,
        temperature: config.role.temperature,
        maxResponseTokens: config.role.maxResponseTokens,
        contextBudget: config.role.contextBudget,
      });

      const result = await loop.run(message);

      if (config.output) {
        return config.output(state, result);
      }

      const handoff = result.structuredOutput
        ? buildHandoffFromResult(config.agentId, message, result.content, result.structuredOutput)
        : buildSimpleHandoff(config.agentId, message, result.content);

      return {
        agentHandoffs: {
          [config.agentId]: handoff,
        },
      } as unknown as Partial<S>;
    };
  };
}

// ── Selector ──

export interface SelectorConfig<S> {
  targets: string[];
  decide: (state: S) => string | typeof END;
  maxRounds: number;
}

export function createSelector<S>(config: SelectorConfig<S>): AgentNodeFn<S> {
  let round = 0;

  return (state: S) => {
    round++;
    if (round > config.maxRounds) {
      return Promise.resolve({
        nextSpeaker: '__END__',
      } as unknown as Partial<S>);
    }
    const chosen = config.decide(state);
    return Promise.resolve({
      nextSpeaker: chosen === END ? '__END__' : chosen,
    } as unknown as Partial<S>);
  };
}
