import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // L1 — Infrastructure
  'packages/types',
  'packages/events',
  'packages/storage',
  // L2 — Agent Core
  'packages/gateway',
  'packages/agent',
  'packages/memory',
  'packages/decision',
  'packages/secretary',
  // L3 — Business
  'packages/workflow',
  'packages/harness',
  // SDK + CLI
  'packages/agent-sdk',
  'packages/cli',
  // UI
  'packages/ui',
  // L4 — Applications
  'apps/server',
  'apps/desktop',
]);
