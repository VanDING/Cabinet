import { spawn, type ChildProcess } from 'node:child_process';
import { getCurrentPlatform, type InstallMethod, type AgentDefinition, getAgentDefinition, AGENT_DEFINITIONS } from '../discovery/agent-definitions.js';

const isWindows = process.platform === 'win32';

export interface InstallProgress {
  stage: 'started' | 'output' | 'completed' | 'failed';
  data?: string;
  exitCode?: number;
}

export interface InstallTask {
  id: string;
  agentId: string;
  method: InstallMethod;
  status: 'running' | 'completed' | 'failed';
  output: string[];
  childProcess?: ChildProcess;
}

const activeTasks = new Map<string, InstallTask>();

export function getInstallMethods(agentId: string): InstallMethod[] | null {
  const def = getAgentDefinition(agentId);
  if (!def) return null;
  const platform = getCurrentPlatform();
  return def.install[platform] ?? [];
}

export function startInstall(
  agentId: string,
  method: InstallMethod,
  onProgress: (progress: InstallProgress) => void,
): string {
  const taskId = `install_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const task: InstallTask = {
    id: taskId,
    agentId,
    method,
    status: 'running',
    output: [],
  };
  activeTasks.set(taskId, task);

  onProgress({ stage: 'started', data: `Running: ${method.command}` });

  const child = spawn(method.command, [], {
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env },
  });
  task.childProcess = child;

  child.stdout?.on('data', (d) => {
    const text = d.toString();
    task.output.push(text);
    onProgress({ stage: 'output', data: text });
  });

  child.stderr?.on('data', (d) => {
    const text = d.toString();
    task.output.push(text);
    onProgress({ stage: 'output', data: text });
  });

  child.on('close', (code) => {
    task.status = code === 0 ? 'completed' : 'failed';
    onProgress({
      stage: code === 0 ? 'completed' : 'failed',
      exitCode: code ?? -1,
      data: code === 0 ? 'Install completed successfully' : `Install failed with exit code ${code}`,
    });
    setTimeout(() => activeTasks.delete(taskId), 60_000);
  });

  child.on('error', (err) => {
    task.status = 'failed';
    onProgress({ stage: 'failed', data: err.message });
    setTimeout(() => activeTasks.delete(taskId), 60_000);
  });

  return taskId;
}

export function cancelInstall(taskId: string): boolean {
  const task = activeTasks.get(taskId);
  if (!task || !task.childProcess) return false;
  try {
    task.childProcess.kill('SIGTERM');
    task.status = 'failed';
    return true;
  } catch {
    return false;
  }
}

export function getInstallTask(taskId: string): InstallTask | undefined {
  return activeTasks.get(taskId);
}

export function getAvailableAgents(): Array<{ definition: AgentDefinition; methods: InstallMethod[] }> {
  const platform = getCurrentPlatform();
  return AGENT_DEFINITIONS.map((def) => ({
    definition: def,
    methods: def.install[platform] ?? [],
  }));
}
