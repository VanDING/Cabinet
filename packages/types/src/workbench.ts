export type DispatchProtocol = 'acp' | 'headless' | 'terminal-only';

export interface InstallMethod {
  type: 'npm' | 'pip' | 'brew' | 'winget' | 'choco' | 'scoop' | 'cargo' | 'binary' | 'manual';
  label: string;
  command: string;
  checkCommand: string;
  elevated?: boolean;
  url?: string;
}

export interface ConfigExtractor {
  file: string;
  format: 'json' | 'yaml' | 'toml';
  apiKeys?: { provider: string; path: string }[];
  mcpServers?: { path: string }[];
  skills?: { path: string }[];
}

export interface ScannerRecipe {
  id: string;
  name: string;
  command: string;
  detectArgs: string[];
  icon: string;
  description: string;
  install: { win32: InstallMethod[]; darwin: InstallMethod[]; linux: InstallMethod[] };
  nativeConfigPaths: { win32: string[]; darwin: string[]; linux: string[] };
  extract: {
    apiKeys?: ConfigExtractor[];
    mcpServers?: ConfigExtractor[];
    skills?: ConfigExtractor[];
  };
  projectorId: string;
  dispatch: {
    protocol: DispatchProtocol;
    headlessArgs?: string[];
    supportsJsonStream?: boolean;
    sdkPackage?: string;
  };
}

export interface ScanResult {
  recipe: ScannerRecipe;
  installed: boolean;
  version?: string;
  extracted?: ExtractedConfig;
  error?: string;
}

export interface ExtractedConfig {
  apiKeys: { provider: string; keyHint: string }[];
  mcpServers: {
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
  }[];
  skills: { name: string; path: string }[];
}

export interface Projector {
  agentId: string;
  nativeConfigPaths(): { win32: string[]; darwin: string[]; linux: string[] };
  project(config: UnifiedConfig, opts: ProjectOptions): Promise<void>;
  extract(): Promise<ExtractedConfig>;
}

export interface UnifiedConfig {
  apiKeys: { provider: string; key: string }[];
  mcpServers: {
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }[];
  skills: { name: string; path: string }[];
  agentSpecific: Record<string, unknown>;
}

export interface ProjectOptions {
  targetDir?: 'user' | 'project' | string;
  dryRun?: boolean;
  mergeStrategy?: 'replace' | 'merge';
}
