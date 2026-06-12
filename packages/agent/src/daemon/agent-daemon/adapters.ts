import { CliAdapter } from '../../adapters/cli-adapter.js';
import { A2AConnector, A2AHarnessRuntime } from '../../adapters/harness/a2a.js';
import { HarnessRuntimeFactory } from '../../adapters/harness/factory.js';
import type { ExternalAgentAdapter } from '../../adapters/types.js';
import type {
  HarnessRuntime,
  HarnessContext,
  HarnessConfig,
} from '../../adapters/harness-runtime.js';
import type { AgentDaemonState } from './internal.js';

export function getAdapter(daemon: AgentDaemonState, agentId: string): ExternalAgentAdapter | null {
  const cached = daemon.adapterCache.get(agentId);
  if (cached) return cached;

  const roleDef = daemon.registry.get(agentId);
  if (!roleDef?.external) return null;

  const ext = roleDef.external;
  let adapter: ExternalAgentAdapter;

  if (ext.protocol === 'cli') {
    adapter = new CliAdapter(
      agentId,
      {
        command: ext.command ?? agentId,
        args: ext.args ?? ['--print'],
        env: ext.env,
        permissionMode: ext.permissionMode as any,
        detectCommand: ext.detectCommand,
        installCommand: ext.installCommand,
        timeoutMs: ext.timeoutMs,
        maxRetries: ext.maxRetries,
      },
      [],
      {
        info: (msg, ctx) => daemon.logger.info(msg, ctx),
        warn: (msg, ctx) => daemon.logger.warn(msg, ctx),
      },
    );
  } else {
    adapter = new A2AConnector(
      agentId,
      {
        baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
        healthCheckUrl: ext.healthCheckUrl,
        authConfig: ext.authConfig as any,
        timeoutMs: ext.timeoutMs,
        maxRetries: ext.maxRetries,
      },
      {
        info: (msg, ctx) => daemon.logger.info(msg, ctx),
        warn: (msg, ctx) => daemon.logger.warn(msg, ctx),
      },
    );
  }

  daemon.adapterCache.set(agentId, adapter);
  return adapter;
}

/**
 * Get or create a HarnessRuntime for the given agent.
 *
 * Unlike getAdapter() which returns a generic ExternalAgentAdapter,
 * this returns a HarnessRuntime that supports harness-specific:
 *   - Prompt format conversion (convertPrompt)
 *   - Output parsing (parseOutput)
 *   - Metrics extraction (extractMetrics)
 *   - Skill injection (injectSkill)
 *   - Session discovery (discoverSessions)
 *
 * CLI agents get their harness auto-detected from the command name.
 * A2A agents get the A2AHarnessRuntime with WebSocket support.
 */
export function getHarnessRuntime(
  daemon: AgentDaemonState,
  agentId: string,
): HarnessRuntime | null {
  const cached = daemon.harnessRuntimeCache.get(agentId);
  if (cached) return cached;

  const roleDef = daemon.registry.get(agentId);
  if (!roleDef?.external) return null;

  const ext = roleDef.external;
  let runtime: HarnessRuntime;

  if (ext.protocol === 'cli') {
    // Build HarnessConfig and let factory auto-detect the harness from command name
    const harnessConfig: HarnessConfig = {
      harnessId: 'generic', // triggers auto-detection in factory
      command: ext.command ?? agentId,
      args: ext.args ?? ['--print'],
      env: ext.env,
      permissionMode: ext.permissionMode as any,
      timeoutMs: ext.timeoutMs,
      maxRetries: ext.maxRetries,
    };

    runtime = HarnessRuntimeFactory.create(agentId, harnessConfig, [], {
      info: (msg, ctx) => daemon.logger.info(msg, ctx),
      warn: (msg, ctx) => daemon.logger.warn(msg, ctx),
    });
  } else {
    // A2A: use first-class A2AHarnessRuntime (with WebSocket support)
    const harnessConfig: HarnessConfig = {
      harnessId: 'a2a',
      baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
      healthCheckUrl: ext.healthCheckUrl,
      authConfig: ext.authConfig as any,
      timeoutMs: ext.timeoutMs,
      maxRetries: ext.maxRetries,
    };

    runtime = new A2AHarnessRuntime(agentId, harnessConfig, {
      info: (msg, ctx) => daemon.logger.info(msg, ctx),
      warn: (msg, ctx) => daemon.logger.warn(msg, ctx),
    });
  }

  daemon.harnessRuntimeCache.set(agentId, runtime);
  daemon.logger.info('HarnessRuntime created', { agentId, harnessId: runtime.harnessId });
  return runtime;
}

/**
 * Build harness context for injection into a task slot.
 * This tells the harness about the execution environment.
 */
export function buildHarnessContext(
  runtime: HarnessRuntime,
  workspacePath?: string,
): HarnessContext {
  return {
    harnessId: runtime.harnessId,
    protocol: runtime.protocol,
    outputFormat:
      runtime.harnessId === 'claude-code'
        ? 'Anthropic tool-use JSON'
        : runtime.harnessId === 'codex'
          ? 'OpenAI function-calling JSON'
          : runtime.harnessId === 'opencode'
            ? 'Markdown with SQLite session'
            : runtime.harnessId === 'a2a'
              ? 'A2A structured JSON over WebSocket/HTTP'
              : 'Cabinet internal format (===CABINET_DELIVERABLE===)',
    permissionProfile: (runtime as any).config?.permissionMode ?? 'auto',
    workspacePath,
  };
}
