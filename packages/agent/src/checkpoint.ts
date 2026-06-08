import { CheckpointRepository, type Database } from '@cabinet/storage';

export interface CheckpointState {
  sessionId: string;
  step: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  toolCallHistory: { name: string; args: Record<string, unknown>; result: unknown }[];
  metadata: Record<string, unknown>;
}

export interface CheckpointRecoveryResult {
  state: CheckpointState | null;
  level: 'full' | 'partial' | 'message' | 'none';
  warning?: string;
}

export class CheckpointManager {
  private readonly repo: CheckpointRepository;

  constructor(db: Database) {
    this.repo = new CheckpointRepository(db);
    this.repo.ensureTable();
  }

  save(state: CheckpointState): void {
    this.repo.save(state.sessionId, JSON.stringify(state));
  }

  load(sessionId: string): CheckpointState | null {
    const result = this.loadWithDegradation(sessionId);
    return result.state;
  }

  loadWithDegradation(sessionId: string): CheckpointRecoveryResult {
    // Level 1: Full state recovery
    const fullState = this.tryLoadFull(sessionId);
    if (fullState) {
      return { state: fullState, level: 'full' };
    }

    // Level 2: Partial recovery — last 5 steps from corrupt JSON
    const partialState = this.tryLoadPartial(sessionId, 5);
    if (partialState) {
      return {
        state: partialState,
        level: 'partial',
        warning: `Checkpoint corrupted — recovered last ${partialState.step} steps. Earlier progress lost.`,
      };
    }

    // Level 3: Last user message only
    const messageState = this.tryLoadLastUserMessage(sessionId);
    if (messageState) {
      return {
        state: messageState,
        level: 'message',
        warning: 'Checkpoint corrupted — only the original request was recovered.',
      };
    }

    // Level 4: Complete failure
    return {
      state: null,
      level: 'none',
      warning: 'Checkpoint completely unrecoverable. Starting from scratch.',
    };
  }

  private tryLoadFull(sessionId: string): CheckpointState | null {
    try {
      const raw = this.repo.load(sessionId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CheckpointState;
      if (!parsed.sessionId || typeof parsed.step !== 'number' || !Array.isArray(parsed.messages)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private tryLoadPartial(sessionId: string, maxSteps: number): CheckpointState | null {
    try {
      const raw = this.repo.load(sessionId);
      if (!raw) return null;

      // Attempt to extract the messages array from corrupted JSON using
      // a forgiving regex that captures the outer messages array.
      const messagesMatch = raw.match(/"messages"\s*:\s*(\[[\s\S]*?\])(?:,\s*"|$)/);
      const stepMatch = raw.match(/"step"\s*:\s*(\d+)/);
      const metadataMatch = raw.match(/"metadata"\s*:\s*(\{[\s\S]*?\})(?:,\s*"|$)/);

      if (!messagesMatch) return null;

      let messages: CheckpointState['messages'] = [];
      try {
        messages = JSON.parse(messagesMatch[1]!) as CheckpointState['messages'];
      } catch {
        // If messages array itself is broken, try line-by-line recovery
        const lines = messagesMatch[1]!.split('\n');
        const recovered: CheckpointState['messages'] = [];
        for (const line of lines) {
          const roleMatch = line.match(/"role"\s*:\s*"(user|assistant)"/);
          const contentMatch = line.match(/"content"\s*:\s*"([^"]*)"/);
          if (roleMatch && contentMatch) {
            recovered.push({
              role: roleMatch[1] as 'user' | 'assistant',
              content: contentMatch[1]!,
            });
          }
        }
        messages = recovered;
      }

      if (messages.length === 0) return null;

      // Keep only the last maxSteps worth of messages (approximate: each step
      // produces one assistant + one user/tool message pair)
      const keepCount = maxSteps * 2;
      const trimmedMessages = messages.slice(-keepCount);

      return {
        sessionId,
        step: stepMatch ? Math.min(parseInt(stepMatch[1]!, 10), maxSteps) : maxSteps,
        messages: trimmedMessages,
        toolCallHistory: [], // Discard tool history to avoid referencing stale state
        metadata: metadataMatch
          ? (JSON.parse(metadataMatch[1]!) as Record<string, unknown>)
          : { projectId: undefined, crashed: true },
      };
    } catch {
      return null;
    }
  }

  private tryLoadLastUserMessage(sessionId: string): CheckpointState | null {
    try {
      const raw = this.repo.load(sessionId);
      if (!raw) return null;

      // Search for the last "role":"user" entry in the raw JSON string
      const userMatches = Array.from(
        raw.matchAll(/\{\s*"role"\s*:\s*"user"\s*,\s*"content"\s*:\s*"([^"]*)"\s*\}/g),
      );
      if (userMatches.length === 0) return null;

      const lastMatch = userMatches[userMatches.length - 1];
      const lastUserContent = lastMatch?.[1];
      if (!lastUserContent) return null;

      return {
        sessionId,
        step: 0,
        messages: [{ role: 'user', content: lastUserContent }],
        toolCallHistory: [],
        metadata: { crashed: true },
      };
    } catch {
      return null;
    }
  }

  delete(sessionId: string): void {
    this.repo.delete(sessionId);
  }
}
