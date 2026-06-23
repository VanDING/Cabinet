import type { ExternalAgentConfig } from '@cabinet/types';

export function buildCliExternalConfig(
  command: string,
  opts?: {
    args?: string[];
    dispatchProtocol?: 'acp' | 'headless' | 'terminal-only';
    nativeConfigPaths?: { win32: string[]; darwin: string[]; linux: string[] };
    sdkPackage?: string;
  },
): ExternalAgentConfig {
  return {
    protocol: 'cli',
    configSource: 'agent_native',
    command,
    args: opts?.args ?? ['--print'],
    dispatchProtocol: opts?.dispatchProtocol,
    nativeConfigPaths: opts?.nativeConfigPaths,
    sdkPackage: opts?.sdkPackage,
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
