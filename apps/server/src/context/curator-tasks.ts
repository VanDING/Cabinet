import type { CuratorDeps, CreateCuratorLoop, EnqueueCuratorTask } from './curator-types.js';

export function createCuratorTasks(
  deps: CuratorDeps,
  createLoop: CreateCuratorLoop,
  enqueue: EnqueueCuratorTask,
) {
  const { logger, memoryFacade } = deps;

  async function runCuratorConsolidation(sessionId: string, transcript: string): Promise<void> {
    const gateway = deps.gateway;
    const loop = createLoop();
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
    const loop = createLoop();
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
    const loop = createLoop();
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

  const handleDecisionUpdate = (
    decisionId: string,
    action: string,
    title: string,
    chosenOptionId: string | undefined,
    _captainId: string | undefined,
  ) => {
    enqueue(
      async () => {
        const loop = createLoop();
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

  return {
    runCuratorConsolidation,
    runCuratorBrief,
    runCuratorPatternExtraction,
    handleDecisionUpdate,
  };
}
