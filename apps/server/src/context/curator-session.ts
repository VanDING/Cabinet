import type { CuratorDeps, EnqueueCuratorTask } from './curator-types.js';

const SESSION_KEEP_OLDEST = 30;
const SESSION_KEEP_RECENT = 30;

export function createSessionWiring(
  deps: CuratorDeps,
  runCuratorConsolidation: (sessionId: string, transcript: string) => Promise<void>,
  runCuratorBrief: (sessionId: string) => Promise<void>,
  enqueue: EnqueueCuratorTask,
) {
  const { logger, memoryFacade, sessionManager } = deps;

  return function wireSessionCallbacks(): void {
    // onSessionClose: persist discoveries + trigger consolidation
    sessionManager.onSessionClose((session) => {
      if (session.contextSlot?.discoveries?.length) {
        for (const discovery of session.contextSlot.discoveries) {
          if (discovery.summary && discovery.summary.length > 10) {
            memoryFacade
              .storeMemory(`[Agent Discovery] ${discovery.type}: ${discovery.summary}`, {
                type: 'agent_discovery',
                source: session.agentType ?? 'unknown',
                sessionId: session.id,
                discoveryType: discovery.type,
              })
              .catch((err) =>
                logger.warn('Slot discovery store failed', { error: (err as Error).message }),
              );
          }
        }
        logger.info('Curator consumed Slot discoveries', {
          sessionId: session.id,
          agentType: session.agentType,
          count: session.contextSlot.discoveries.length,
        });
      }

      if (deps.gateway && session.messages.length > 0) {
        const messages = session.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
        if (messages.length > 200) {
          enqueue(
            () => runCuratorConsolidation(session.id, messages),
            'consolidation',
            'high',
          ).catch((e) =>
            logger.warn('Curator on-close consolidation failed', { error: (e as Error).message }),
          );
        }
      }
    });

    // onFirstUserMessage: generate session brief after 30s delay
    sessionManager.onFirstUserMessage((session) => {
      if (deps.gateway) {
        setTimeout(() => {
          enqueue(() => runCuratorBrief(session.id), 'brief', 'high').catch((e) =>
            logger.warn('Curator first-message brief failed', { error: (e as Error).message }),
          );
        }, 30000);
      }
    });

    // onCompressionNeeded: summarize middle messages via LLM, fallback to truncation
    sessionManager.onCompressionNeeded((session) => {
      const gw = deps.gateway;
      if (!gw) return;
      const middleStart = SESSION_KEEP_OLDEST;
      const middleEnd = session.messages.length - SESSION_KEEP_RECENT;
      const middleMessages = session.messages.slice(middleStart, middleEnd);
      const middleText = middleMessages
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n');

      if (middleText.length > 200) {
        enqueue(
          async () => {
            try {
              const resp = await gw.generateText({
                model: 'claude-haiku-4-5',
                messages: [
                  {
                    role: 'user',
                    content: `Summarize this conversation segment in 2-3 sentences (in the original language), capturing key decisions, topics discussed, and outcomes:\n\n${middleText.slice(0, 4000)}`,
                  },
                ],
                maxTokens: 200,
                temperature: 0.1,
              });
              sessionManager.compactMessages(session.id, resp.content.trim());
              logger.info('Session compression completed', {
                sessionId: session.id,
                msgCount: session.messages.length,
              });
            } catch (e) {
              // Fallback: simple truncation
              sessionManager.compactMessages(
                session.id,
                `${middleMessages.length} intermediate messages compressed.`,
              );
              logger.warn('Session compression fell back to truncation', {
                sessionId: session.id,
                error: (e as Error).message,
              });
            }
          },
          'compress',
          'high',
        ).catch((e) =>
          logger.warn('Session compression failed', {
            sessionId: session.id,
            error: (e as Error).message,
          }),
        );
      }
    });
  };
}
