import type { HarnessRuntime, HarnessConfig, AgentTaskMetrics } from '../harness-runtime.js';
import type { ExternalTask, ExternalTaskResult, AgentCapability } from '../types.js';
import { AcpClient } from './acp-client.js';

export class AcpRuntime implements HarnessRuntime {
  readonly protocol = 'cli' as const;
  readonly harnessId = 'acp';
  private client: AcpClient | null = null;
  private sessionId: string | null = null;

  constructor(
    readonly agentId: string,
    protected config: HarnessConfig,
    protected capabilities: AgentCapability[] = [],
  ) {}

  async start(): Promise<void> {
    this.client = new AcpClient(
      this.config.command ?? this.agentId,
      this.config.args ?? [],
      this.config.env,
    );
    await this.client.connect();
  }

  async stop(): Promise<void> {
    await this.client?.disconnect();
    this.client = null;
    this.sessionId = null;
  }

  async healthCheck(): Promise<boolean> {
    return this.client !== null;
  }

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    if (!this.client) await this.start();
    const startedAt = new Date().toISOString();
    try {
      if (!this.sessionId) {
        this.sessionId = await this.client!.newSession(
          task.configuration.working_directory ?? process.cwd(),
        );
      }
      let finalOutput = '';
      this.client!.onUpdate((u) => {
        const msg = (u as { message?: string }).message;
        if (msg) finalOutput += msg;
      });
      await this.client!.prompt(this.sessionId, this.convertPrompt(task));
      return {
        task_id: task.task_id,
        status: 'completed',
        output: finalOutput || '[ACP session produced no text output]',
        discoveries: [],
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    } catch (err) {
      return {
        task_id: task.task_id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    }
  }

  convertPrompt(task: ExternalTask): string {
    return typeof task.input === 'string' ? task.input : JSON.stringify(task.input);
  }

  parseOutput(
    _stdout: string,
    _stderr: string,
    taskId: string,
    startedAt: string,
  ): ExternalTaskResult {
    return {
      task_id: taskId,
      status: 'completed',
      output: _stdout,
      audit: { started_at: startedAt, completed_at: new Date().toISOString() },
    };
  }

  extractMetrics(): AgentTaskMetrics {
    return {};
  }

  injectSkill(): string {
    return '';
  }

  async cancelTask(taskId: string): Promise<void> {
    if (this.client && this.sessionId) await this.client.cancel(this.sessionId);
  }

  getCapabilities(): AgentCapability[] {
    return this.capabilities;
  }
}
