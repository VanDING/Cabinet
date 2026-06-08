import { createCuratorLoop as _createCuratorLoop } from './curator-loop.js';
/**
 * Curator subsystem — background knowledge consolidation, session briefs,
 * pattern extraction, and preference learning. Extracted from context.ts
 * to keep getServerContext() under the 500-line limit.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '@cabinet/storage';
import type { LLMGateway } from '@cabinet/gateway';
import type { CostTracker } from '@cabinet/gateway';
import { AgentLoop, SafetyChecker, CheckpointManager } from '@cabinet/agent';
import type { ToolDependencies, AgentRoleRegistry } from '@cabinet/agent';
import { createStandardToolExecutor } from '../agent-factory.js';
import { createFileCapabilities, createKnowledgeCapabilities } from '../capabilities.js';
import { broadcast } from '../ws/handler.js';
import type {
  ShortTermMemory,
  LongTermMemory,
  EntityMemory,
  ProjectMemory,
  MemoryFacade,
} from '@cabinet/memory';
import type { DecisionService } from '@cabinet/decision';
import type { EventBus } from '@cabinet/events';
import type { DecisionRepository } from '@cabinet/storage';
import type { SessionManager } from '@cabinet/secretary';
import type { SubconsciousLoop, HarnessAnalyst } from '@cabinet/harness';
import { DEFAULT_CAPTAIN_ID, DelegationTier } from '@cabinet/types';

const RAG_CURATOR_TOP_K = 10;

// ── Types ──

export interface CuratorDeps {
  db: Database;
  /** Mutable — checked at call time; may be null if no API key configured */
  gateway: LLMGateway | null;
  agentRegistry: AgentRoleRegistry;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
  sessionManager: SessionManager;
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  memoryFacade: MemoryFacade;
  decisionRepo: DecisionRepository;
  decisionService: DecisionService;
  eventBus: EventBus;
  currentTier: DelegationTier;
  costTracker: CostTracker;
  subconsciousLoop: SubconsciousLoop;
  harnessAnalyst: HarnessAnalyst;
  /** Full ServerContext (for capCtx fallback) — use sparingly */
  ctx: Record<string, unknown>;
}

export interface CuratorSubsystem {
  /** Set up all curator-driven timers. Returns handles for shutdown. */
  setupTimers: () => CuratorTimers;
  /** Handler for decision preference updates — wire into context.ts deferred trigger. */
  handleDecisionUpdate: (
    decisionId: string,
    action: string,
    title: string,
    chosenOptionId: string | undefined,
    captainId: string | undefined,
  ) => void;
}

export interface CuratorTimers {
  curatorNudge: NodeJS.Timeout;
  curatorPattern: NodeJS.Timeout;
  subconscious: NodeJS.Timeout;
  harnessAnalyst: NodeJS.Timeout;
}

// ── Subsystem factory ──

export function setupCuratorSubsystem(deps: CuratorDeps): CuratorSubsystem {
  const {
    db,
    logger,
    shortTerm,
    longTerm,
    entity,
    project,
    memoryFacade,
    decisionRepo,
    decisionService,
    eventBus,
    currentTier,
    costTracker,
    sessionManager,
  } = deps;
  // NOTE: ctx is NOT destructured — it's accessed via deps.ctx

  // ── Curator AgentLoop factory (delegated to curator-loop.ts) ──
  function createCuratorLoop(): AgentLoop | null {
    return _createCuratorLoop(deps as unknown as Parameters<typeof _createCuratorLoop>[0]);
  }

  // ── Curator dual-queue priority concurrency control ──

  let curatorBusy = false;
  const highPriorityQueue: Array<{ task: () => Promise<void>; label: string }> = [];
  const lowPriorityQueue: Array<{ task: () => Promise<void>; label: string }> = [];

  async function enqueueCuratorTask(
    task: () => Promise<void>,
    label: string,
    priority: 'high' | 'low' = 'low',
  ): Promise<void> {
    if (curatorBusy) {
      const queue = priority === 'high' ? highPriorityQueue : lowPriorityQueue;
      const existingIdx = queue.findIndex((t) => t.label === label);
      if (existingIdx !== -1) {
        queue[existingIdx] = { task, label };
      } else {
        queue.push({ task, label });
      }
      return;
    }
    curatorBusy = true;
    try {
      await task();
    } finally {
      curatorBusy = false;
      const next = highPriorityQueue.shift() ?? lowPriorityQueue.shift();
      if (next) {
        enqueueCuratorTask(next.task, next.label, priority).catch((e) =>
          logger.warn('Curator queued task failed', {
            label: next.label,
            error: (e as Error).message,
          }),
        );
      }
    }
  }

  // ── Curator task implementations ──

  async function runCuratorConsolidation(sessionId: string, transcript: string): Promise<void> {
    const gateway = deps.gateway;
    const loop = createCuratorLoop();
    if (!loop) {
      logger.warn('Curator consolidation skipped — no gateway or role');
      return;
    }

    let processedTranscript = transcript;
    if (transcript.length > 8000) {
      const chunks: string[] = [];
      let offset = 0;
      const chunkSize = 4000;
      const overlap = 200;
      while (offset < transcript.length) {
        chunks.push(transcript.slice(offset, offset + chunkSize));
        if (offset + chunkSize >= transcript.length) break;
        offset += chunkSize - overlap;
      }

      if (gateway && chunks.length > 1) {
        const chunkSummaries: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          try {
            const resp = await gateway.generateText({
              model: 'claude-haiku-4-5',
              messages: [
                {
                  role: 'user',
                  content: `Summarize this conversation segment in one sentence (in the original language):\n\n${chunks[i]}`,
                },
              ],
              maxTokens: 150,
              temperature: 0.1,
            });
            chunkSummaries.push(`[Segment ${i + 1}]: ${resp.content.trim()}`);
          } catch {
            chunkSummaries.push(`[Segment ${i + 1}]: (summary unavailable)`);
          }
        }
        processedTranscript = chunkSummaries.join('\n');
      }
    }

    const taskPrompt = [
      `## Background Consolidation Task`,
      '',
      `You are running as a background curator. Consolidate knowledge from this session transcript.`,
      '',
      `Instructions:`,
      `1. Read the transcript and identify important facts, decisions, and insights.`,
      `2. Use search_memory to check if similar information already exists in long-term memory.`,
      `3. Use write_memory to persist NEW or UPDATED information (importance ≥ 0.5). Skip duplicates.`,
      `4. Use query_decisions to check if any discussed decisions already have formal records.`,
      `5. Use update_project_summary if the project direction has meaningfully changed.`,
      `6. Use remember to store a brief session summary in short-term memory for the next interaction.`,
      '',
      `Session transcript:`,
      processedTranscript.slice(0, 8000),
      '',
      `After completing all steps, output a one-line summary of what you consolidated.`,
    ].join('\n');

    try {
      const result = await loop.run(taskPrompt);
      logger.info('Curator consolidation completed', {
        sessionId,
        steps: result.steps,
        toolCalls: result.toolCalls,
        preview: result.content.slice(0, 200),
      });
    } catch (e) {
      logger.warn('Curator consolidation failed', { sessionId, error: (e as Error).message });
    }
  }

  async function runCuratorBrief(sessionId: string): Promise<void> {
    const loop = createCuratorLoop();
    if (!loop) return;

    const taskPrompt = [
      `## Session Brief Task`,
      '',
      `A new session has just been created. Prepare a context brief that will be shown to the Captain at session start.`,
      '',
      `Instructions:`,
      `1. Use get_recent_events to see what happened recently.`,
      `2. Use query_decisions to find pending decisions that need attention.`,
      `3. Use search_memory to find relevant recent context.`,
      `4. Use get_project_context to understand the current project state.`,
      `5. Synthesize a brief (2-3 concise sentences) covering: recent activity, pending decisions, and what needs attention.`,
      '',
      `After your analysis, output ONLY the brief text — no JSON, no tools, just the plain text brief.`,
    ].join('\n');

    try {
      const result = await loop.run(taskPrompt);
      const brief = result.content.trim();
      if (brief.length > 0) {
        memoryFacade.remember(sessionId, 'session_brief', brief);
        logger.info('Curator session brief prepared', { sessionId, preview: brief.slice(0, 200) });
      }
    } catch (e) {
      logger.warn('Curator session brief failed', { sessionId, error: (e as Error).message });
    }
  }

  async function runCuratorPatternExtraction(): Promise<void> {
    const loop = createCuratorLoop();
    if (!loop) return;

    const taskPrompt = [
      `## Pattern Extraction Task`,
      '',
      `You are the Curator. Review recent history to extract patterns.`,
      '',
      `Instructions:`,
      `1. Use query_decisions to list all decisions from the last 7 days.`,
      `2. Use get_decision to review key decisions — look for patterns in what was chosen.`,
      `3. Use search_memory to find related context around each decision.`,
      `4. Use get_captain_preferences to see current preference profile.`,
      `5. Identify patterns: recurring decision types, risk tolerance signals, cost sensitivity, preferred decision styles.`,
      `6. Use write_memory to store each pattern you find (importance ≥ 0.7).`,
      `7. If patterns differ from current preferences, use set_captain_preferences to update the preference profile.`,
      `8. Use update_project_summary if the overall project picture has changed.`,
      '',
      `Focus on actionable patterns — not vague observations. Each pattern should cite specific decisions as evidence.`,
    ].join('\n');

    try {
      const result = await loop.run(taskPrompt);
      logger.info('Curator pattern extraction completed', {
        steps: result.steps,
        toolCalls: result.toolCalls,
        preview: result.content.slice(0, 200),
      });
    } catch (e) {
      logger.warn('Curator pattern extraction failed', { error: (e as Error).message });
    }
  }

  // ── Decision preference update handler (wired from context.ts deferred trigger) ──

  const handleDecisionUpdate = (
    decisionId: string,
    action: string,
    title: string,
    chosenOptionId: string | undefined,
    _captainId: string | undefined,
  ) => {
    enqueueCuratorTask(
      async () => {
        const loop = createCuratorLoop();
        if (!loop) return;

        const taskPrompt = [
          `## Decision Preference Update`,
          '',
          `A decision was just ${action}: "${title}" (id: ${decisionId}, chosen: ${chosenOptionId ?? 'none'}).`,
          '',
          `Instructions:`,
          `1. Use get_decision to read the full decision record.`,
          `2. Use get_captain_preferences to see the current preference profile.`,
          `3. Analyze what this decision reveals about the Captain's preferences (risk tolerance, cost sensitivity, decision style).`,
          `4. If you detect a shift or refinement, use set_captain_preferences to update the profile.`,
          `5. Use write_memory to store any notable pattern you discover.`,
          '',
          `Be concise — this is a background task triggered by each decision resolution.`,
        ].join('\n');

        const result = await loop.run(taskPrompt);
        logger.info('Curator decision preference update completed', {
          decisionId,
          action,
          preview: result.content.slice(0, 150),
        });
      },
      'preference',
      'low',
    ).catch((e) => {
      logger.warn('Curator decision preference update failed', {
        decisionId,
        error: (e as Error).message,
      });
    });
  };

  // ── Timer setup ──

  function setupTimers(): CuratorTimers {
    // Curator self-nudge: runs every 4 hours
    const curatorNudge = setInterval(
      async () => {
        if (!deps.gateway) return;
        try {
          const sessions = sessionManager.list();
          for (const s of sessions) {
            if (s.messages.length > 0) {
              const messages = s.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
              if (messages.length > 200) {
                await enqueueCuratorTask(
                  () => runCuratorConsolidation(s.id, messages),
                  'nudge',
                  'low',
                );
              }
            }
          }
        } catch (e) {
          logger.warn('Curator nudge failed', { error: (e as Error).message });
          broadcast('background_error', { task: 'curator_nudge', error: (e as Error).message });
        }
      },
      4 * 60 * 60 * 1000,
    );
    curatorNudge.unref();
    logger.info('Curator self-nudge scheduled (4h)');

    // Curator cross-session pattern extraction: runs every 6 hours
    const curatorPattern = setInterval(
      async () => {
        if (!deps.gateway) return;
        try {
          await enqueueCuratorTask(() => runCuratorPatternExtraction(), 'pattern', 'low');
        } catch (e) {
          logger.warn('Curator pattern extraction failed', { error: (e as Error).message });
          broadcast('background_error', { task: 'curator_pattern', error: (e as Error).message });
        }
      },
      6 * 60 * 60 * 1000,
    );
    curatorPattern.unref();
    logger.info('Curator pattern extraction scheduled (6h)');

    // Subconscious loop: via Curator queue every hour
    const subconscious = setInterval(
      () => {
        enqueueCuratorTask(
          async () => {
            await deps.subconsciousLoop.tick();
            logger.info('Curator: subconscious loop tick completed');
          },
          'subconscious',
          'low',
        );
      },
      60 * 60 * 1000,
    );
    subconscious.unref();
    logger.info('Curator: subconscious loop scheduled (1h)');

    // Harness analysis: via Curator queue every 3 hours
    const harnessAnalyst = setInterval(
      () => {
        enqueueCuratorTask(
          async () => {
            const insight = await deps.harnessAnalyst.analyze();
            if (insight) {
              logger.info('Curator: harness analysis generated insight');
              broadcast('subconscious_insight', {
                text: insight,
                relevance: 0.9,
                relatedEntities: [],
                timestamp: new Date().toISOString(),
              });
            }
          },
          'harness_analysis',
          'low',
        );
      },
      3 * 60 * 60 * 1000,
    );
    harnessAnalyst.unref();
    logger.info('Curator: harness analyst scheduled (3h)');

    return { curatorNudge, curatorPattern, subconscious, harnessAnalyst };
  }

  // ── Session lifecycle wiring (called from context.ts) ──

  const SESSION_KEEP_OLDEST = 30;
  const SESSION_KEEP_RECENT = 30;

  function wireSessionCallbacks(): void {
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
          enqueueCuratorTask(
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
          enqueueCuratorTask(() => runCuratorBrief(session.id), 'brief', 'high').catch((e) =>
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
        enqueueCuratorTask(
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
  }

  // Wire immediately
  wireSessionCallbacks();

  return { setupTimers, handleDecisionUpdate };
}
