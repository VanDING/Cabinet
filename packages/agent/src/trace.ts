export interface TraceOptions {
  runId?: string;
  /** Called for each trace line. Default: console.log with timestamp. */
  write?: (line: string) => void;
}

/**
 * Minimal stream event shape consumed by the tracer.
 * This used to be imported from `@cabinet/graph`; it is now local so the
 * agent package no longer depends on the graph package.
 */
type StreamEvent =
  | { type: 'node:start'; nodeId: string }
  | { type: 'node:end'; nodeId: string }
  | { type: 'error'; nodeId: string; error: unknown }
  | { type: 'checkpoint:saved'; checkpointId: string }
  | { type: string; nodeId?: string; checkpointId?: string; error?: unknown };

/**
 * Consume a graph's stream and print a structured trace.
 * Usage:
 *   for await (const _ of trace(graph.stream(state, config)))
 *     ; // no-op — side effects only
 */
export async function* trace<S>(
  input: AsyncGenerator<StreamEvent>,
  options: TraceOptions = {},
): AsyncGenerator<StreamEvent> {
  const runId = options.runId ?? `run_${Date.now()}`;
  const write = options.write ?? ((line) => console.log(line));
  const start = Date.now();

  write(`[trace] ${elapsed(start)} ── ${runId} start ──`);

  for await (const event of input) {
    switch (event.type) {
      case 'node:start':
        write(`[trace] ${elapsed(start)} ▶ ${event.nodeId}`);
        break;
      case 'node:end':
        write(`[trace] ${elapsed(start)} ✓ ${event.nodeId}`);
        break;
      case 'error':
        write(`[trace] ${elapsed(start)} ✗ ${event.nodeId}: ${event.error}`);
        break;
      case 'checkpoint:saved':
        write(`[trace] ${elapsed(start)} ● ${event.checkpointId}`);
        break;
      default:
        // silently skip llm:chunk, tool:call, tool:result, etc.
        break;
    }
    yield event;
  }

  write(`[trace] ${elapsed(start)} ── ${runId} end (${elapsed(start)}) ──`);
}

function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  if (ms < 1000) return `${ms}ms`.padStart(8);
  return `${(ms / 1000).toFixed(1)}s`.padStart(8);
}
