import { SignalProvider } from '@mastra/core/signals';
import type { SignalProviderTarget } from '@mastra/core/signals';
import type { InputProcessorOrWorkflow } from '@mastra/core/processors';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getServerContext } from '../../context.js';

export class CabinetDecisionSignalProvider extends SignalProvider<'cabinet-decisions'> {
  readonly id = 'cabinet-decisions' as const;
  readonly name = 'Cabinet Decision Signals';
  readonly pollInterval = 60_000;

  getTools() {
    const subscribeDecisionsTool = createTool({
      id: 'subscribeDecisions',
      description: 'Subscribe current thread to Cabinet decision events',
      inputSchema: z.object({ threadId: z.string(), resourceId: z.string() }),
      execute: async ({ context }: any) => {
        const threadId = (context as any)?.threadId;
        const resourceId = (context as any)?.resourceId;
        if (!threadId || !resourceId) {
          return { error: 'Thread context not available — provide threadId and resourceId' };
        }
        this.subscribe({ threadId, resourceId }, 'cabinet:decisions');
        return { subscribed: true };
      },
    });

    const unsubscribeDecisionsTool = createTool({
      id: 'unsubscribeDecisions',
      description: 'Unsubscribe from Cabinet decision events',
      inputSchema: z.object({ threadId: z.string(), resourceId: z.string() }),
      execute: async ({ context }: any) => {
        const threadId = (context as any)?.threadId;
        const resourceId = (context as any)?.resourceId;
        if (!threadId || !resourceId) return { error: 'Thread context not available' };
        this.unsubscribe({ threadId, resourceId }, 'cabinet:decisions');
        return { unsubscribed: true };
      },
    });

    const listPendingDecisionsTool = createTool({
      id: 'listPendingDecisions',
      description: 'List pending Cabinet decisions',
      inputSchema: z.object({}),
      execute: async () => {
        const { decisionService } = getServerContext();
        const decisions = (decisionService as any).listPending?.() ?? [];
        return { decisions };
      },
    });

    return {
      subscribeDecisions: subscribeDecisionsTool,
      unsubscribeDecisions: unsubscribeDecisionsTool,
      listPendingDecisions: listPendingDecisionsTool,
    };
  }

  /**
   * Poll periodically to check for new decisions and notify subscribed threads.
   */
  async poll(): Promise<void> {
    const subs = this.getSubscriptions();
    if (subs.length === 0) return;

    try {
      const { decisionRepo } = getServerContext();
      const recent = decisionRepo.listAllPending({ limit: 5 });

      for (const decision of recent) {
        for (const sub of subs) {
          await this.notify(
            {
              source: 'cabinet',
              kind: 'decision_created',
              summary: `${decision.title}: ${(decision as any).description ?? ''}`.slice(0, 200),
              priority: (decision as any).urgency === 'red' ? ('HIGH' as any) : ('MEDIUM' as any),
              metadata: {
                decisionId: decision.id,
                title: decision.title,
              },
            },
            { threadId: sub.threadId, resourceId: sub.resourceId },
          );
        }
      }
    } catch {
      /* decision repo may not be available during startup */
    }
  }

  /**
   * Allow external systems to push decisions via HTTP webhook.
   */
  async handleWebhook(request: { body: unknown; headers: Record<string, string> }) {
    const body = request.body as {
      threadId?: string;
      resourceId?: string;
      title?: string;
      description?: string;
      urgency?: string;
    } | null;
    if (!body?.title || !body?.description) {
      return { status: 400, body: { error: 'title and description required' } };
    }

    const subs = this.getSubscriptionsForResource('cabinet:decisions');

    for (const sub of subs) {
      await this.notify(
        {
          source: 'webhook',
          kind: 'external_decision',
          summary: `${body.title}: ${body.description}`.slice(0, 200),
          priority: body.urgency === 'red' ? ('HIGH' as any) : ('MEDIUM' as any),
        },
        { threadId: sub.threadId, resourceId: sub.resourceId },
      );
    }

    return { status: 200, body: { notified: subs.length } };
  }
}
