import { CheckpointRepository, type Database } from '@cabinet/storage';

export interface CheckpointState {
  sessionId: string;
  step: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  toolCallHistory: { name: string; args: Record<string, unknown>; result: unknown }[];
  metadata: Record<string, unknown>;
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
    try {
      const raw = this.repo.load(sessionId);
      if (!raw) return null;
      return JSON.parse(raw) as CheckpointState;
    } catch {
      // Corrupt checkpoint data — discard and start fresh
      this.delete(sessionId);
      return null;
    }
  }

  delete(sessionId: string): void {
    this.repo.delete(sessionId);
  }
}
