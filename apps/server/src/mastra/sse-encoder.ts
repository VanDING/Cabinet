export interface SSEEncoderOptions {
  onText?: (text: string) => void;
  abortSignal?: AbortSignal;
}

export function createSSEStream(
  reader: ReadableStreamDefaultReader,
  options?: SSEEncoderOptions,
): ReadableStream {
  const encoder = new TextEncoder();
  let aborted = false;

  if (options?.abortSignal) {
    options.abortSignal.addEventListener('abort', () => {
      aborted = true;
    });
  }

  function emit(controller: ReadableStreamDefaultController, data: Record<string, unknown>) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  return new ReadableStream({
    async start(controller) {
      try {
        let text = '';

        while (!aborted) {
          const { done, value } = await reader.read();
          if (done || aborted) break;

          const chunk: any = value;
          const payload = chunk.payload ?? {};

          switch (chunk.type) {
            // ── Text ──────────────────────────────────────────────
            case 'text-delta': {
              const delta = payload.text ?? '';
              text += delta;
              emit(controller, { content: delta });
              break;
            }
            case 'text-start': {
              emit(controller, { type: 'text_start' });
              break;
            }
            case 'text-end':
              break;

            // ── Reasoning / Thinking ──────────────────────────────
            case 'reasoning-delta':
              emit(controller, { type: 'thinking', content: payload.text ?? '' });
              break;
            case 'reasoning-start':
              emit(controller, { type: 'thinking_start' });
              break;
            case 'reasoning-end':
              emit(controller, { type: 'thinking_done' });
              break;
            case 'reasoning-signature':
            case 'redacted-reasoning':
              emit(controller, { type: 'thinking', content: `[${chunk.type}: redacted]` });
              break;

            // ── Tool Calls ────────────────────────────────────────
            case 'tool-call':
              emit(controller, {
                type: 'tool_status',
                toolType: 'call',
                message: `Calling ${payload.toolName}`,
                detail: { name: payload.toolName, args: payload.args },
              });
              break;
            case 'tool-call-delta':
              emit(controller, {
                type: 'tool_status',
                toolType: 'call_delta',
                detail: { name: payload.toolName, argsDelta: payload.argsTextDelta },
              });
              break;
            case 'tool-result':
              emit(controller, {
                type: 'tool_status',
                toolType: 'result',
                message: `Done ${payload.toolName}`,
                detail: { name: payload.toolName, result: payload.result },
              });
              break;
            case 'tool-error':
              emit(controller, {
                type: 'tool_status',
                toolType: 'error',
                message: `Error in ${payload.toolName}`,
                detail: { name: payload.toolName, error: String(payload.error ?? '') },
              });
              break;

            // ── Step lifecycle ────────────────────────────────────
            case 'step-start':
              emit(controller, { type: 'step_start', stepNumber: payload.stepNumber });
              break;
            case 'step-finish': {
              if (payload.usage) {
                emit(controller, {
                  type: 'usage',
                  promptTokens: payload.usage.inputTokens,
                  completionTokens: payload.usage.outputTokens,
                });
              }
              emit(controller, { type: 'step_finish', usage: payload.usage });
              break;
            }

            // ── Finish / Error / Abort ────────────────────────────
            case 'finish': {
              const usage = payload.usage || payload.output?.usage;
              emit(controller, {
                type: 'done',
                ...(usage
                  ? {
                      usage: {
                        promptTokens: usage.inputTokens,
                        completionTokens: usage.outputTokens,
                      },
                    }
                  : {}),
              });
              break;
            }
            case 'error':
              emit(controller, {
                type: 'error',
                message: String(payload.error ?? payload.message ?? ''),
              });
              controller.close();
              return;
            case 'abort':
              emit(controller, { type: 'aborted' });
              controller.close();
              return;

            // ── Background tasks ─────────────────────────────────
            case 'background-task-started':
            case 'background-task-completed':
            case 'background-task-failed':
              emit(controller, {
                type: 'task_status',
                tasks: [
                  {
                    id: payload.taskId ?? '',
                    name: payload.taskName ?? '',
                    status:
                      chunk.type === 'background-task-started'
                        ? 'running'
                        : chunk.type === 'background-task-completed'
                          ? 'completed'
                          : 'error',
                  },
                ],
              });
              break;
            case 'background-task-progress':
              emit(controller, {
                type: 'task_status',
                tasks: [
                  {
                    id: payload.taskId ?? '',
                    name: payload.taskName ?? '',
                    status: 'running',
                    progress: payload.progress,
                  },
                ],
              });
              break;

            // ── Structured output ─────────────────────────────────
            case 'object':
            case 'object-result':
              emit(controller, {
                type: 'structured_output',
                outputType: chunk.type === 'object-result' ? 'final' : 'partial',
                data: payload.object ?? payload,
              });
              break;

            // ── Metadata passthrough ──────────────────────────────
            case 'start':
              emit(controller, { type: 'run_start' });
              break;
            case 'source':
            case 'file':
              emit(controller, { type: `meta_${chunk.type}`, data: payload });
              break;
            case 'raw':
              if (payload.chunk) {
                emit(controller, { type: 'raw', data: payload.chunk });
              }
              break;

            // ── Goal / Task completion check ──────────────────────
            case 'is-task-complete':
              emit(controller, { type: 'task_goal_check', completed: payload.isComplete });
              break;
            case 'goal':
              emit(controller, {
                type: 'goal',
                description: payload.description,
                achieved: payload.achieved,
              });
              break;

            // ── Forward-compat: emit unknown chunk types as generic events ──
            default:
              if (chunk.type && payload && Object.keys(payload).length > 0) {
                emit(controller, { type: `raw_${chunk.type}`, data: payload });
              }
              break;
          }
        }

        if (!aborted) {
          emit(controller, { type: 'done' });
        }
        controller.close();
        options?.onText?.(text);
      } catch (err) {
        if (aborted) {
          emit(controller, { type: 'aborted' });
        } else {
          emit(controller, { type: 'error', message: String(err) });
        }
        controller.close();
      }
    },
  });
}
