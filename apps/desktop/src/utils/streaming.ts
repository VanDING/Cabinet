export interface SSEStreamCallbacks {
  onContent: (content: string, fullContent: string) => void;
  onDone: (fullContent: string, doneEvent?: Record<string, unknown>) => void;
  onError: (error: string) => void;
  onRoutingStart?: (targetAgent: string) => void;
  onRouting?: (targetAgent: string) => void;
  onThinking?: (content: string) => void;
  onThinkingDone?: () => void;
  onToolStatus?: (message: string, type: 'call' | 'result' | 'error', detail?: { name: string; args?: unknown; result?: unknown }) => void;
  onTaskUpdate?: (tasks: Array<{ id: string; name: string; status: 'pending' | 'running' | 'done' | 'error'; startTime?: number; endTime?: number }>) => void;
  onStopped?: () => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
}

export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSEStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  let fullContent = '';
  let done = false;
  let doneEvent: Record<string, unknown> | undefined;

  while (!done) {
    if (signal?.aborted) {
      callbacks.onStopped?.();
      return;
    }
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    const text = decoder.decode(value, { stream: true });
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          done = true;
          break;
        }
        try {
          const parsed = JSON.parse(data);
          // Support typed events: {type:"done",...} and {type:"chunk",content:"..."}
          if (parsed.type === 'done') {
            doneEvent = parsed;
            done = true;
            break;
          }
          if (parsed.type === 'error') {
            fullContent = `Error: ${parsed.message ?? 'Unknown error'}`;
            callbacks.onError(fullContent);
            done = true;
            break;
          }
          if (parsed.type === 'routing_start') {
            callbacks.onRoutingStart?.(parsed.targetAgent ?? 'secretary');
            continue;
          }
          if (parsed.type === 'routing') {
            callbacks.onRouting?.(parsed.targetAgent ?? 'secretary');
            continue;
          }
          if (parsed.type === 'thinking') {
            callbacks.onThinking?.(parsed.content ?? '');
            continue;
          }
          if (parsed.type === 'thinking_done') {
            callbacks.onThinkingDone?.();
            continue;
          }
          if (parsed.type === 'tool_status') {
            callbacks.onToolStatus?.(
              parsed.message ?? '',
              parsed.toolType ?? 'call',
              parsed.detail,
            );
            continue;
          }
          if (parsed.type === 'usage') {
            callbacks.onUsage?.({
              promptTokens: parsed.promptTokens ?? 0,
              completionTokens: parsed.completionTokens ?? 0,
            });
            continue;
          }
          if (parsed.type === 'task_status') {
            const tasks = (parsed.tasks ?? []).map((t: any) => ({
              id: String(t.id ?? ''),
              name: String(t.name ?? ''),
              status: (['pending', 'running', 'done', 'error'].includes(t.status) ? t.status : 'pending') as 'pending' | 'running' | 'done' | 'error',
              startTime: typeof t.startTime === 'number' ? t.startTime : undefined,
              endTime: typeof t.endTime === 'number' ? t.endTime : undefined,
            }));
            callbacks.onTaskUpdate?.(tasks);
            continue;
          }
          if (parsed.type === 'status') {
            callbacks.onContent('', fullContent);
            continue;
          }
          if (parsed.content) {
            fullContent += parsed.content;
          } else if (parsed.error) {
            fullContent = `Error: ${parsed.error}`;
          }
          callbacks.onContent(parsed.content ?? '', fullContent);
        } catch {
          /* ignore parse errors on partial SSE chunks */
        }
      }
    }
  }

  callbacks.onDone(fullContent, doneEvent);
}

export function formatPipelineResponse(data: {
  dispatchMode: string;
  totalSteps?: number;
  totalDurationMs?: number;
  steps?: Array<{ role: string; status: string; durationMs: number; agentSteps: number }>;
  response?: string;
}): string {
  const stepLines = (data.steps ?? []).map(
    (s) => `- **${s.role}**: ${s.status} (${s.durationMs}ms, ${s.agentSteps} steps)`,
  );
  return [
    `**Dispatch Mode:** ${data.dispatchMode}`,
    `**Total Steps:** ${data.totalSteps} | **Duration:** ${data.totalDurationMs}ms`,
    '',
    '### Pipeline Steps',
    ...stepLines,
    '',
    '### Result',
    data.response ?? '',
  ].join('\n');
}
