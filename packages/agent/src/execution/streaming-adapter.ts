import {
  TaskTracker,
  type AgentTask,
  SemanticTaskTracker,
  type SemanticTask,
} from '../task-tracker.js';
import type { AgentEvent } from '../observer-pipeline.js';
import { formatToolTaskName } from './format-task.js';
import type { StreamingCallback } from './types.js';

/** Adapts AgentEvent stream to the legacy StreamingCallback interface. */
export class StreamingCallbackAdapter {
  private fullText = '';
  private estimatedSteps = 1;
  private warnedBudget = false;
  private taskTracker = new TaskTracker();
  private semanticTracker = new SemanticTaskTracker();
  private taskMap = new Map<string, string>();
  private afterToolResult = false;
  private readonly maxSteps: number;

  constructor(
    private callback: StreamingCallback,
    maxSteps = 50,
  ) {
    this.maxSteps = maxSteps;
  }

  forward(event: AgentEvent): void {
    switch (event.type) {
      case 'text': {
        if (this.afterToolResult) {
          this.estimatedSteps++;
          this.afterToolResult = false;
          this.semanticTracker.completeCurrentStep();
          const remaining = this.maxSteps - this.estimatedSteps;
          if (!this.warnedBudget && remaining <= Math.ceil(this.maxSteps * 0.25)) {
            this.warnedBudget = true;
            this.callback.onStepBudgetWarning?.(remaining, this.maxSteps);
          }
        }
        this.fullText += event.content;
        this.callback.onChunk?.(event.content);
        break;
      }
      case 'thinking':
        this.callback.onThinking?.(event.content);
        break;
      case 'thinking_done':
        this.callback.onThinkingDone?.();
        break;
      case 'tool_call': {
        this.afterToolResult = false;
        const taskName = formatToolTaskName(event.name, event.args);
        const taskId = this.taskTracker.addTask(taskName);
        this.taskMap.set(event.id, taskId);
        this.callback.onTaskUpdate?.(this.taskTracker.getTasks());
        this.callback.onToolCall?.(event.name, event.args);
        const commandHint =
          event.name === 'execCommand' || event.name === 'exec_command'
            ? String(event.args?.command ?? '')
            : undefined;
        this.semanticTracker.addToolCall(event.id, event.name, commandHint);
        this.callback.onSemanticTaskUpdate?.(this.semanticTracker.getTasks());
        break;
      }
      case 'tool_result': {
        this.afterToolResult = true;
        const taskId = this.taskMap.get(event.id);
        if (taskId) {
          const hasError = typeof event.result === 'string' && event.result.startsWith('Error');
          this.taskTracker.completeTask(taskId, !hasError);
          this.callback.onTaskUpdate?.(this.taskTracker.getTasks());
        }
        this.callback.onToolResult?.(event.name, event.result);
        break;
      }
      case 'usage':
        this.callback.onUsage?.(event.usage);
        break;
      case 'step_budget_warning':
        this.callback.onStepBudgetWarning?.(event.remaining, event.max);
        break;
      case 'error':
        this.callback.onError?.(event.message);
        this.semanticTracker.finalizeAll(false);
        this.callback.onSemanticTaskUpdate?.(this.semanticTracker.getTasks());
        break;
      case 'done': {
        if (
          this.estimatedSteps >= this.maxSteps &&
          !this.fullText.includes('[INCOMPLETE: max_steps_reached]')
        ) {
          this.fullText += '\n\n[INCOMPLETE: max_steps_reached]';
        }
        this.semanticTracker.finalizeAll(true);
        this.callback.onSemanticTaskUpdate?.(this.semanticTracker.getTasks());
        this.callback.onDone?.(this.fullText);
        break;
      }
    }
  }
}

export type { AgentTask, SemanticTask };
