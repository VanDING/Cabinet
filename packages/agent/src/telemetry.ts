import { registerTelemetry } from 'ai';

let registered = false;

/**
 * Initialize AI SDK OpenTelemetry integration.
 * Call once at application startup.
 *
 * Note: @ai-sdk/otel is required at runtime but not imported here
 * to avoid version conflicts during the beta transition.
 * Import and pass it when registering:
 *
 *   import { OpenTelemetry } from '@ai-sdk/otel';
 *   initTelemetry({ otel: new OpenTelemetry({ ... }) });
 */
export function initTelemetry(options?: {
  serviceName?: string;
  sessionId?: string;
  projectId?: string;
  otel?: any;
}): void {
  if (registered) return;
  registered = true;

  if (options?.otel) {
    registerTelemetry(options.otel);
  }
}
