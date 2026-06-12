import { DEFAULT_PIS_CONFIG } from '@cabinet/types';
import { ObserverPipeline, type AgentObserver } from '../observer-pipeline.js';
import { ContextMonitor, type ContextMonitor as ContextMonitorType } from '../context-monitor.js';
import { SafetyCheckObserver } from '../observers/safety.js';
import { ToolExecuteObserver } from '../observers/tool-execute.js';
import { StepEventObserver } from '../observers/step-event-observer.js';
import { ContextMonitorObserver } from '../observers/context-monitor.js';
import { HandoffObserver } from '../observers/handoff.js';
import { ProcessIdentityObserver } from '../observers/process-identity-observer.js';
import { BlackboardObserver } from '../observers/blackboard-observer.js';
import { ContentGuardObserver } from '../observers/content-guard.js';
import { ReflectionObserver } from '../observers/reflection.js';
import { JudgeObserver } from '../observers/judge.js';
import { AutoReplanObserver } from '../observers/auto-replan.js';
import { CheckpointObserver } from '../observers/checkpoint.js';
import { SelfConsistencyObserver } from '../observers/self-consistency.js';
import { SubconsciousInsightObserver } from '../observers/subconscious-insight.js';
import { EmbeddingService } from '../embedding-service.js';
import { resolveObserverActivation } from './observer-presets.js';
import type { AgentLoopOptions } from './agent-loop-options.js';
import type { LLMGateway } from '@cabinet/gateway';
import type { SafetyChecker } from '../safety.js';
import type { CheckpointManager } from '../checkpoint.js';

export interface ObserverFactoryResult {
  pipeline: ObserverPipeline;
  selfConsistencyEngine: import('../reasoning/self-consistency.js').SelfConsistencyEngine | null;
}

export function createObserverPipeline(
  options: AgentLoopOptions,
  gateway: LLMGateway,
  safetyChecker: SafetyChecker,
  checkpointManager: CheckpointManager,
  contextMonitor: ContextMonitorType | null,
): ObserverFactoryResult {
  const activation = resolveObserverActivation({
    preset: options.observerPreset,
    pis: options.pis,
    reflection: options.reflection,
    judge: options.judge,
    autoReplan: options.autoReplan,
    selfConsistency: options.selfConsistency,
  });

  // Pre-compile Observer Pipeline
  const observers: AgentObserver[] = [
    new SafetyCheckObserver(safetyChecker),
    new ToolExecuteObserver(),
  ];

  // Step event recorder (4.0)
  if (options.stepEvents?.enabled && options.db) {
    observers.push(new StepEventObserver(options.sessionId, options.stepEvents, options.db));
  }

  if (contextMonitor) {
    observers.push(new ContextMonitorObserver(contextMonitor));
    observers.push(new HandoffObserver());
  }

  // Process Identity Score observer (4.3)
  if (activation.pis && options.eventBus) {
    observers.push(
      new ProcessIdentityObserver(
        options.taskDescription ?? '',
        { ...DEFAULT_PIS_CONFIG, ...options.pis },
        options.eventBus,
        new EmbeddingService(gateway),
      ),
    );
  }

  // Blackboard mid-session sync observer (B.1)
  if (options.eventBus && options.blackboard) {
    observers.push(new BlackboardObserver(options.eventBus, ['discoveries']));
  }

  // Subconscious insight injection (C.3) — bridge harness SubconsciousLoop to AgentLoop
  if (options.eventBus && activation.reflection) {
    observers.push(new SubconsciousInsightObserver(options.eventBus));
  }

  // Content guardrails observer (P0-2)
  if (options.guardrails?.enabled) {
    observers.unshift(new ContentGuardObserver(options.guardrails));
  }

  // Reflection observer (P0-1) — placed before HandoffObserver so handoff happens after critique
  if (activation.reflection) {
    observers.push(
      new ReflectionObserver(
        options.reflection ?? { enabled: false, maxRounds: 2, qualityThreshold: 0.7 },
        gateway,
      ),
    );
  }

  // Judge observer (P0-3) — evaluates output quality
  if (activation.judge) {
    observers.push(
      new JudgeObserver(
        options.judge ?? { enabled: false, sampleRate: 0.1, taskFilter: [] },
        gateway,
        options.taskDescription,
      ),
    );
  }

  // Auto-replan observer (P1-5) — detects tool errors and triggers LLM analysis
  if (activation.autoReplan) {
    observers.push(
      new AutoReplanObserver(
        options.autoReplan ?? { enabled: false, errorThreshold: 2, maxReplanRounds: 3 },
        gateway,
      ),
    );
  }

  // Self-consistency observer (P1-6) — engine exposed for callers to use on high-stakes tasks
  let selfConsistencyEngine:
    | import('../reasoning/self-consistency.js').SelfConsistencyEngine
    | null = null;
  if (activation.selfConsistency) {
    const observer = new SelfConsistencyObserver(
      options.selfConsistency ?? { enabled: false, samples: 3, triggerTasks: [] },
      gateway,
    );
    observers.push(observer);
    selfConsistencyEngine = observer.getEngine();
  }

  observers.push(new CheckpointObserver(checkpointManager));

  return {
    pipeline: new ObserverPipeline(observers),
    selfConsistencyEngine,
  };
}
