import type { ServerContext } from './types.js';

export interface BuildState extends Partial<ServerContext> {
  dataDir: string;
  dbPath: string;
  dbMode: 'file' | 'memory';
}
