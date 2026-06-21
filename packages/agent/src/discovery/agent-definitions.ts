export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  detectArgs: string[];
  description: string;
  configPaths: {
    win32?: string[];
    darwin?: string[];
    linux?: string[];
  };
  configFormat: 'json' | 'yaml';
  extract: {
    apiKeys?: { provider: string; jsonPath: string }[];
    mcpServers?: { jsonPath: string }[];
    skills?: { jsonPath: string }[];
  };
  install: {
    win32: InstallMethod[];
    darwin: InstallMethod[];
    linux: InstallMethod[];
  };
}

export interface InstallMethod {
  type: 'npm' | 'pip' | 'brew' | 'winget' | 'binary' | 'cargo' | 'manual';
  label: string;
  command: string;
  checkCommand: string;
  elevated?: boolean;
  url?: string;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    detectArgs: ['--version'],
    description: 'Anthropic coding agent for terminal',
    configPaths: {
      win32: ['%USERPROFILE%\\.claude.json'],
      darwin: ['~/.claude.json'],
      linux: ['~/.claude.json'],
    },
    configFormat: 'json',
    extract: {
      apiKeys: [{ provider: 'anthropic', jsonPath: 'primaryApiKey' }],
      mcpServers: [{ jsonPath: 'mcpServers' }],
    },
    install: {
      win32: [
        { type: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/claude-code', checkCommand: 'claude --version' },
      ],
      darwin: [
        { type: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/claude-code', checkCommand: 'claude --version' },
      ],
      linux: [
        { type: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/claude-code', checkCommand: 'claude --version' },
      ],
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    detectArgs: ['--version'],
    description: 'OpenAI coding agent',
    configPaths: {
      win32: ['%USERPROFILE%\\.codex\\config.json'],
      darwin: ['~/.codex/config.json'],
      linux: ['~/.codex/config.json'],
    },
    configFormat: 'json',
    extract: {
      apiKeys: [{ provider: 'openai', jsonPath: 'api_key' }],
      mcpServers: [{ jsonPath: 'mcp_servers' }],
    },
    install: {
      win32: [
        { type: 'npm', label: 'npm', command: 'npm install -g @openai/codex', checkCommand: 'codex --version' },
      ],
      darwin: [
        { type: 'npm', label: 'npm', command: 'npm install -g @openai/codex', checkCommand: 'codex --version' },
        { type: 'brew', label: 'Homebrew', command: 'brew install codex', checkCommand: 'codex --version' },
      ],
      linux: [
        { type: 'npm', label: 'npm', command: 'npm install -g @openai/codex', checkCommand: 'codex --version' },
      ],
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    detectArgs: ['--version'],
    description: 'Open-source AI coding agent',
    configPaths: {
      win32: ['%USERPROFILE%\\.opencode\\config.json'],
      darwin: ['~/.opencode/config.json'],
      linux: ['~/.opencode/config.json'],
    },
    configFormat: 'json',
    extract: {
      mcpServers: [{ jsonPath: 'mcp' }],
    },
    install: {
      win32: [
        { type: 'npm', label: 'npm', command: 'npm install -g opencode', checkCommand: 'opencode --version' },
      ],
      darwin: [
        { type: 'npm', label: 'npm', command: 'npm install -g opencode', checkCommand: 'opencode --version' },
        { type: 'brew', label: 'Homebrew', command: 'brew install opencode', checkCommand: 'opencode --version' },
      ],
      linux: [
        { type: 'npm', label: 'npm', command: 'npm install -g opencode', checkCommand: 'opencode --version' },
      ],
    },
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    command: 'gemini',
    detectArgs: ['--version'],
    description: 'Google Gemini terminal agent',
    configPaths: {
      win32: ['%APPDATA%\\gemini-cli\\config.json'],
      darwin: ['~/.config/gemini-cli/config.json'],
      linux: ['~/.config/gemini-cli/config.json'],
    },
    configFormat: 'json',
    extract: {
      apiKeys: [{ provider: 'google', jsonPath: 'apiKey' }],
    },
    install: {
      win32: [
        { type: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/gemini-cli', checkCommand: 'gemini --version' },
      ],
      darwin: [
        { type: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/gemini-cli', checkCommand: 'gemini --version' },
        { type: 'brew', label: 'Homebrew', command: 'brew install gemini-cli', checkCommand: 'gemini --version' },
      ],
      linux: [
        { type: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/gemini-cli', checkCommand: 'gemini --version' },
      ],
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    command: 'kimi',
    detectArgs: ['--version'],
    description: 'Moonshot Kimi CLI agent',
    configPaths: {
      win32: ['%USERPROFILE%\\.kimi\\config.json'],
      darwin: ['~/.kimi/config.json'],
      linux: ['~/.kimi/config.json'],
    },
    configFormat: 'json',
    extract: {
      apiKeys: [{ provider: 'moonshot', jsonPath: 'api_key' }],
    },
    install: {
      win32: [
        { type: 'pip', label: 'pip', command: 'pip install kimi-cli', checkCommand: 'kimi --version' },
      ],
      darwin: [
        { type: 'pip', label: 'pip', command: 'pip install kimi-cli', checkCommand: 'kimi --version' },
      ],
      linux: [
        { type: 'pip', label: 'pip', command: 'pip install kimi-cli', checkCommand: 'kimi --version' },
      ],
    },
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    command: 'qwen-code',
    detectArgs: ['--version'],
    description: 'Alibaba Qwen coding agent',
    configPaths: {
      win32: ['%USERPROFILE%\\.qwen\\config.json'],
      darwin: ['~/.qwen/config.json'],
      linux: ['~/.qwen/config.json'],
    },
    configFormat: 'json',
    extract: {
      apiKeys: [{ provider: 'qwen', jsonPath: 'api_key' }],
    },
    install: {
      win32: [
        { type: 'npm', label: 'npm', command: 'npm install -g @qwen-code/qwen-code', checkCommand: 'qwen-code --version' },
      ],
      darwin: [
        { type: 'npm', label: 'npm', command: 'npm install -g @qwen-code/qwen-code', checkCommand: 'qwen-code --version' },
      ],
      linux: [
        { type: 'npm', label: 'npm', command: 'npm install -g @qwen-code/qwen-code', checkCommand: 'qwen-code --version' },
      ],
    },
  },
  {
    id: 'glm',
    name: 'GLM CLI',
    command: 'glm',
    detectArgs: ['--version'],
    description: 'Zhipu GLM coding agent',
    configPaths: {
      win32: ['%USERPROFILE%\\.zhipu\\config.json'],
      darwin: ['~/.zhipu/config.json'],
      linux: ['~/.zhipu/config.json'],
    },
    configFormat: 'json',
    extract: {
      apiKeys: [{ provider: 'zhipu', jsonPath: 'api_key' }],
    },
    install: {
      win32: [
        { type: 'pip', label: 'pip', command: 'pip install glm-cli', checkCommand: 'glm --version' },
      ],
      darwin: [
        { type: 'pip', label: 'pip', command: 'pip install glm-cli', checkCommand: 'glm --version' },
      ],
      linux: [
        { type: 'pip', label: 'pip', command: 'pip install glm-cli', checkCommand: 'glm --version' },
      ],
    },
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    detectArgs: ['--version'],
    description: 'Cursor IDE agent CLI',
    configPaths: {
      win32: ['%APPDATA%\\Cursor\\config.json'],
      darwin: ['~/.cursor/config.json'],
      linux: ['~/.cursor/config.json'],
    },
    configFormat: 'json',
    extract: {
      mcpServers: [{ jsonPath: 'mcpServers' }],
    },
    install: {
      win32: [
        { type: 'npm', label: 'npm', command: 'npm install -g @cursor-ai/cursor-agent', checkCommand: 'cursor-agent --version' },
      ],
      darwin: [
        { type: 'npm', label: 'npm', command: 'npm install -g @cursor-ai/cursor-agent', checkCommand: 'cursor-agent --version' },
      ],
      linux: [
        { type: 'npm', label: 'npm', command: 'npm install -g @cursor-ai/cursor-agent', checkCommand: 'cursor-agent --version' },
      ],
    },
  },
];

export function getAgentDefinition(id: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((a) => a.id === id);
}

export function getAgentDefinitionByCommand(command: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((a) => a.command === command);
}

export function getCurrentPlatform(): 'win32' | 'darwin' | 'linux' {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}
