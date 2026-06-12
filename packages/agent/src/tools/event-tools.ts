import { MessageType } from '@cabinet/types';
import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createEventTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Event/Monitoring Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_recent_events',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const correlationId = args.correlationId as string | undefined;
        if (correlationId) {
          return deps.eventBus.getCausationChain(correlationId);
        }
        return { message: 'Provide correlationId to trace event chain' };
      },
    },
    {
      name: 'publish_notification',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const messageId = `tool_notify_${Date.now()}`;
        await deps.eventBus.publish({
          messageId,
          correlationId: messageId,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: {
            type: 'tool_notification',
            message: args.message as string,
            data: { level: (args.level as string) ?? 'info' },
          },
        });
        return { published: true, messageId };
      },
    },
  ];
}
