import type { MemoryLayer } from '@cabinet/types';

export interface MemoryWriteOptions {
  layer: MemoryLayer;
  key: string;
  value: unknown;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  layer: MemoryLayer;
  key?: string;
  query?: string;
  limit?: number;
}

export interface MemoryOrchestrator {
  write(options: MemoryWriteOptions): Promise<void>;
  read(query: MemoryQuery): Promise<unknown>;
  delete(layer: MemoryLayer, key: string): Promise<boolean>;
  consolidate(sessionId: string): Promise<number>; // returns items migrated
}
