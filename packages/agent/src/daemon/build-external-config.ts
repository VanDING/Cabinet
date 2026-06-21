import type { ExternalAgentConfig } from '@cabinet/types';

export function buildCliExternalConfig(
  command: string,
  args: string[] = ['--print'],
  dispatchProtocol?: 'acp' | 'headless' | 'terminal-only',
): ExternalAgentConfig {
  return {
    protocol: 'cli',
    configSource: 'agent_native',
    command,
    args,
    dispatchProtocol,
    timeoutMs: 300_000,
    maxRetries: 2,
  };
}

export function buildA2AExternalConfig(baseUrl: string): ExternalAgentConfig {
  return {
    protocol: 'a2a',
    configSource: 'agent_native',
    baseUrl,
    timeoutMs: 120_000,
    maxRetries: 2,
  };
}
