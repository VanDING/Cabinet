export interface SSEStreamCallbacks {
  onContent: (content: string, fullContent: string) => void;
  onDone: (fullContent: string) => void;
  onError: (error: string) => void;
}

export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSEStreamCallbacks,
): Promise<void> {
  const decoder = new TextDecoder();
  let fullContent = '';
  let done = false;

  while (!done) {
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
            done = true;
            break;
          }
          if (parsed.type === 'error') {
            fullContent = `Error: ${parsed.message ?? 'Unknown error'}`;
            callbacks.onError(fullContent);
            done = true;
            break;
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

  callbacks.onDone(fullContent);
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
