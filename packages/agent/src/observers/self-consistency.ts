import type { LLMGateway } from '@cabinet/gateway';
import type { AgentExecutionContext } from '../observer-pipeline.js';
import {
  SelfConsistencyEngine,
  type SelfConsistencyConfig,
} from '../reasoning/self-consistency.js';
import type { AgentObserver } from '../observer-pipeline.js';

/**
 * SelfConsistencyObserver wraps the self-consistency engine and exposes it
 * through the standard ObserverPipeline. It allows callers to obtain the engine
 * for high-stakes task sampling while keeping observer lifecycle uniform.
 */
export class SelfConsistencyObserver implements AgentObserver {
  name = 'SelfConsistency';
  private readonly engine: SelfConsistencyEngine;

  constructor(config: SelfConsistencyConfig, gateway: LLMGateway) {
    this.engine = new SelfConsistencyEngine(config, gateway);
  }

  getEngine(): SelfConsistencyEngine {
    return this.engine;
  }

  async onStreamStart(_ctx: AgentExecutionContext): Promise<void> {
    // Engine is stateless across stream lifecycle; no-op.
  }

  async onStreamEnd(_ctx: AgentExecutionContext): Promise<void> {
    // No-op: sampling is invoked explicitly by callers.
  }

  async onStepEnd(_ctx: AgentExecutionContext): Promise<void> {
    // No-op: self-consistency runs on demand, not per-step.
  }
}

export type { SelfConsistencyConfig };
