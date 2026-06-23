import type { EventLogRepository } from '@cabinet/storage';
import type { MessageEnvelope, MessageType } from '@cabinet/types';

type EventHandler = (msg: MessageEnvelope) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private repo: EventLogRepository | null;

  constructor(repo: EventLogRepository) {
    this.repo = repo;
  }

  publish(msg: MessageEnvelope): Promise<void> {
    try {
      this.repo?.append(msg);
    } catch {
      /* repo unavailable */
    }

    const handlers = this.handlers.get(msg.messageType);
    if (handlers) {
      return Promise.all([...handlers].map((h) => Promise.resolve(h(msg)))).then(() => {});
    }
    return Promise.resolve();
  }

  subscribe(messageType: MessageType, handler: EventHandler): () => void {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, new Set());
    }
    this.handlers.get(messageType)!.add(handler);
    return () => {
      this.handlers.get(messageType)?.delete(handler);
    };
  }

  get deadLetterQueue() {
    return {
      setDb: (_db: unknown) => {},
    };
  }
}

export class AgentEventRepository {
  private db: unknown;
  constructor(db: unknown) {
    this.db = db;
  }
  insert = (_event: unknown) => {};
  findByParent = (_sessionId: string) => [];
}

export class AgentEventBus {
  private broadcast: unknown;
  private repo: AgentEventRepository;
  private onDeliverable: ((parentSessionId: string, deliverable: unknown) => void) | undefined;

  constructor(
    broadcast: unknown,
    repo: AgentEventRepository,
    onDeliverable?: (parentSessionId: string, deliverable: unknown) => void,
  ) {
    this.broadcast = broadcast;
    this.repo = repo;
    this.onDeliverable = onDeliverable;
  }

  publish(childSessionId: string, parentSessionId: string, event: unknown): void {
    try {
      this.repo.insert({ childSessionId, parentSessionId, event, timestamp: Date.now() });
    } catch {
      /* repo unavailable */
    }
  }

  subscribe = (_type: string, _handler: unknown) => {};
}
