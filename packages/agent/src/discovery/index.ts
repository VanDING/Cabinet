import { spawn } from 'node:child_process';
import { AGENT_DEFINITIONS, getCurrentPlatform, type AgentDefinition } from './agent-definitions.js';
import { scanAgentConfig, type ScannedConfig } from './config-scanner.js';

const isWindows = process.platform === 'win32';

export interface DetectedAgent {
  definition: AgentDefinition;
  installed: boolean;
  version?: string;
  config?: ScannedConfig;
}

function detectCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: isWindows,
      timeout: 5000,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on('error', () => resolve({ code: -1, stdout, stderr }));
  });
}

export async function detectAgent(def: AgentDefinition): Promise<DetectedAgent | null> {
  const { code, stdout } = await detectCommand(def.command, def.detectArgs);
  if (code === 0 && stdout.trim().length > 0) {
    return {
      definition: def,
      installed: true,
      version: stdout.trim(),
    };
  }

  // Fallback: which/where
  const fallbackCmd = isWindows ? 'where' : 'which';
  const { code: fc, stdout: fs } = await detectCommand(fallbackCmd, [def.command]);
  if (fc === 0 && fs.trim().length > 0) {
    return { definition: def, installed: true };
  }

  return null;
}

export async function scanAllAgents(): Promise<DetectedAgent[]> {
  const results: DetectedAgent[] = [];
  for (const def of AGENT_DEFINITIONS) {
    const detected = await detectAgent(def);
    if (detected) {
      const config = await scanAgentConfig(def);
      if (config.rawConfigs.length > 0 || config.apiKeys.length > 0 || config.mcpServers.length > 0) {
        detected.config = config;
      }
      results.push(detected);
    }
  }
  return results;
}

export { AGENT_DEFINITIONS, getCurrentPlatform };
