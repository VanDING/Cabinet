import type { ScannerRecipe } from '@cabinet/types';

export const RECIPES: ScannerRecipe[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    detectArgs: ['--version'],
    icon: 'claude',
    description: "Anthropic's official coding agent CLI with ACP support.",
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          checkCommand: 'claude --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          checkCommand: 'claude --version',
        },
        {
          type: 'brew',
          label: 'Homebrew',
          command: 'brew install claude-code',
          checkCommand: 'claude --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          checkCommand: 'claude --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.claude\\settings.json', '%USERPROFILE%\\.claude.json'],
      darwin: ['~/.claude/settings.json', '~/.claude.json'],
      linux: ['~/.claude/settings.json', '~/.claude.json'],
    },
    extract: {
      apiKeys: [
        {
          file: '~/.claude/settings.json',
          format: 'json',
          apiKeys: [{ provider: 'anthropic', path: 'env.ANTHROPIC_API_KEY' }],
        },
      ],
      mcpServers: [
        { file: '~/.claude.json', format: 'json', mcpServers: [{ path: 'mcpServers' }] },
      ],
    },
    projectorId: 'claude-code',
    dispatch: { protocol: 'acp', sdkPackage: '@anthropic-ai/claude-agent-sdk' },
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    detectArgs: ['--version'],
    icon: 'codex',
    description: 'OpenAI Codex CLI — terminal AI coding agent.',
    // [unverified] codex --version, config paths, dispatch protocol
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @openai/codex',
          checkCommand: 'codex --version',
        },
        {
          type: 'winget',
          label: 'winget',
          command: 'winget install OpenAI.Codex',
          checkCommand: 'codex --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @openai/codex',
          checkCommand: 'codex --version',
        },
        {
          type: 'brew',
          label: 'Homebrew',
          command: 'brew install --cask codex',
          checkCommand: 'codex --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @openai/codex',
          checkCommand: 'codex --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.codex\\config.toml'],
      darwin: ['~/.codex/config.toml'],
      linux: ['~/.codex/config.toml'],
    },
    extract: {},
    projectorId: 'codex',
    dispatch: { protocol: 'acp' },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    detectArgs: ['--version'],
    icon: 'opencode',
    description: 'OpenCode — terminal AI coding agent (from opencode.ai).',
    // [unverified] opencode run flag for headless dispatch
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g opencode-ai',
          checkCommand: 'opencode --version',
        },
        {
          type: 'scoop',
          label: 'scoop',
          command: 'scoop install opencode',
          checkCommand: 'opencode --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g opencode-ai',
          checkCommand: 'opencode --version',
        },
        {
          type: 'brew',
          label: 'Homebrew',
          command: 'brew install opencode',
          checkCommand: 'opencode --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g opencode-ai',
          checkCommand: 'opencode --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%APPDATA%\\opencode\\opencode.json'],
      darwin: ['~/.config/opencode/opencode.json'],
      linux: ['~/.config/opencode/opencode.json'],
    },
    extract: {},
    projectorId: 'opencode',
    dispatch: { protocol: 'headless', headlessArgs: ['run', ''], supportsJsonStream: true },
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    command: 'gemini',
    detectArgs: ['--version'],
    icon: 'gemini',
    description: "Google's Gemini CLI — terminal AI assistant.",
    // [unverified] gemini --version, config paths, npm package name
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @google/gemini-cli',
          checkCommand: 'gemini --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @google/gemini-cli',
          checkCommand: 'gemini --version',
        },
        {
          type: 'brew',
          label: 'Homebrew',
          command: 'brew install gemini-cli',
          checkCommand: 'gemini --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @google/gemini-cli',
          checkCommand: 'gemini --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.config\\google-gemini\\config.json'],
      darwin: ['~/.config/google-gemini/config.json'],
      linux: ['~/.config/google-gemini/config.json'],
    },
    extract: {},
    projectorId: 'gemini-cli',
    dispatch: {
      protocol: 'headless',
      headlessArgs: ['-p', '', '--output-format', 'json'],
      supportsJsonStream: true,
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    command: 'kimi',
    detectArgs: ['--version'],
    icon: 'kimi',
    description: 'Kimi CLI — terminal AI assistant from Moonshot AI.',
    // [unverified] kimi --version, config paths, headless flags
    install: {
      win32: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install kimi-cli',
          checkCommand: 'kimi --version',
        },
      ],
      darwin: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install kimi-cli',
          checkCommand: 'kimi --version',
        },
      ],
      linux: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install kimi-cli',
          checkCommand: 'kimi --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.kimi\\config.json'],
      darwin: ['~/.kimi/config.json'],
      linux: ['~/.kimi/config.json'],
    },
    extract: {},
    projectorId: 'kimi',
    dispatch: { protocol: 'headless', headlessArgs: ['-p', ''], supportsJsonStream: false },
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    command: 'qwen-code',
    detectArgs: ['--version'],
    icon: 'qwen',
    description: "Alibaba's Qwen Coder CLI — coding agent.",
    // [unverified] qwen-code --version, config paths, headless flags
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @qwen-code/qwen-code',
          checkCommand: 'qwen-code --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @qwen-code/qwen-code',
          checkCommand: 'qwen-code --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @qwen-code/qwen-code',
          checkCommand: 'qwen-code --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.qwen\\config.json'],
      darwin: ['~/.qwen/config.json'],
      linux: ['~/.qwen/config.json'],
    },
    extract: {},
    projectorId: 'qwen-code',
    dispatch: { protocol: 'headless', headlessArgs: ['-p', ''], supportsJsonStream: false },
  },
  {
    id: 'glm',
    name: 'GLM',
    command: 'glm',
    detectArgs: ['--version'],
    icon: 'glm',
    description: 'GLM CLI — Zhipu AI terminal coding agent.',
    // [unverified] glm --version, config paths, headless flags
    install: {
      win32: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install glm-cli',
          checkCommand: 'glm --version',
        },
      ],
      darwin: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install glm-cli',
          checkCommand: 'glm --version',
        },
      ],
      linux: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install glm-cli',
          checkCommand: 'glm --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.zhipu\\config.json'],
      darwin: ['~/.zhipu/config.json'],
      linux: ['~/.zhipu/config.json'],
    },
    extract: {},
    projectorId: 'glm',
    dispatch: { protocol: 'headless', headlessArgs: ['-p', ''], supportsJsonStream: false },
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    detectArgs: ['--version'],
    icon: 'aider',
    description: 'Aider — terminal AI pair programming in your terminal.',
    install: {
      win32: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install aider-chat',
          checkCommand: 'aider --version',
        },
      ],
      darwin: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install aider-chat',
          checkCommand: 'aider --version',
        },
        {
          type: 'brew',
          label: 'Homebrew',
          command: 'brew install aider',
          checkCommand: 'aider --version',
        },
      ],
      linux: [
        {
          type: 'pip',
          label: 'pip',
          command: 'pip install aider-chat',
          checkCommand: 'aider --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.aider.conf.yml'],
      darwin: ['~/.aider.conf.yml'],
      linux: ['~/.aider.conf.yml'],
    },
    extract: {},
    projectorId: 'aider',
    dispatch: {
      protocol: 'headless',
      headlessArgs: ['--message', '', '--yes', '--json'],
      supportsJsonStream: true,
    },
  },
  {
    id: 'cline',
    name: 'Cline',
    command: 'cline',
    detectArgs: ['--version'],
    icon: 'cline',
    description: 'Cline — autonomous coding agent CLI with SDK support.',
    // [unverified] cline --version, config paths
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g cline',
          checkCommand: 'cline --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g cline',
          checkCommand: 'cline --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g cline',
          checkCommand: 'cline --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.cline\\config.json'],
      darwin: ['~/.cline/config.json'],
      linux: ['~/.cline/config.json'],
    },
    extract: {},
    projectorId: 'cline',
    dispatch: { protocol: 'headless', headlessArgs: ['--json', ''], supportsJsonStream: true },
  },
];
