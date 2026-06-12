import type { ExternalAgentAdapter, A2AAgentConfig } from '../../types.js';
import type { HarnessConfig } from '../../harness-runtime.js';
import { A2AHarnessRuntime } from './runtime.js';

/** Backward-compatible alias for {@link A2AHarnessRuntime}.
 *  Prefer {@link HarnessRuntimeFactory} for new code.
 *  @deprecated Use A2AHarnessRuntime or HarnessRuntimeFactory directly.
 */
export class A2AConnector extends A2AHarnessRuntime implements ExternalAgentAdapter {
  constructor(
    agentId: string,
    config: A2AAgentConfig,
    logger?: {
      info: (msg: string, ctx?: unknown) => void;
      warn: (msg: string, ctx?: unknown) => void;
    },
  ) {
    super(agentId, { ...(config as unknown as HarnessConfig), harnessId: 'a2a' }, logger);
  }
}
