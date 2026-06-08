import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import { CheckpointManager } from '../checkpoint.js';

export class CheckpointObserver implements AgentObserver {
  name = 'Checkpoint';
  private manager: CheckpointManager;
  private checkpointInterval: number;
  private lastSavedStep = 0;

  constructor(manager: CheckpointManager, checkpointInterval = 5) {
    this.manager = manager;
    this.checkpointInterval = checkpointInterval;
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<void> {
    if (ctx.stepCount - this.lastSavedStep >= this.checkpointInterval) {
      this.manager.save({
        sessionId: ctx.sessionId,
        step: ctx.stepCount,
        messages: ctx.messages,
        toolCallHistory: ctx.toolCallHistory,
        metadata: { projectId: ctx.projectId },
      });
      this.lastSavedStep = ctx.stepCount;
    }
  }

  async onStreamEnd(ctx: AgentExecutionContext): Promise<void> {
    this.manager.delete(ctx.sessionId);
    this.lastSavedStep = 0;
  }
}
