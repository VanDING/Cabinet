import type { CapabilitiesContext } from './types.js';
import { createFileCapabilities } from './file.js';
import { createWebCapabilities } from './web.js';
import { createShellCapabilities } from './shell.js';
import { createSchedulerCapabilities } from './scheduler.js';
import { createKnowledgeCapabilities } from './knowledge.js';
import { createEvaluationCapabilities } from './evaluation.js';
import { createLSPCapabilities } from './lsp.js';
import { createSystemKnowledgeCapabilities } from './system-knowledge.js';
import { createDocumentCapabilities } from './document.js';
import { createArchiveCapabilities } from './archive.js';
import { createBrowserCapabilities } from './browser.js';
import { createCommunicationCapabilities } from './communication.js';
import { createSystemCapabilities } from './system.js';

/** Build capabilities from server context. Pass `allowed` to restrict capability areas. */
export function createAllCapabilities(
  ctx: CapabilitiesContext,
  allowed?: Array<'file' | 'web' | 'shell' | 'scheduler' | 'knowledge' | 'evaluation' | 'lsp'>,
  defaultProjectId?: string,
) {
  const all = {
    ...createFileCapabilities(ctx),
    ...createWebCapabilities(ctx),
    ...createShellCapabilities(ctx),
    ...createSchedulerCapabilities(ctx, defaultProjectId),
    ...createKnowledgeCapabilities(ctx),
    ...createEvaluationCapabilities(ctx),
    ...createLSPCapabilities(),
    ...createSystemKnowledgeCapabilities(ctx),
    ...createDocumentCapabilities(),
    ...createArchiveCapabilities(),
    ...createBrowserCapabilities(),
    ...createCommunicationCapabilities(),
    ...createSystemCapabilities(),
  };
  if (!allowed || allowed.length === 0) return all;
  const areaMap: Record<string, string[]> = {
    file: [
      'readFile',
      'writeFile',
      'listFiles',
      'searchFiles',
      'readDirectory',
      'makeDirectory',
      'moveFile',
      'copyFile',
      'deleteFile',
      'removeDirectory',
      'readFileChunk',
      'globFiles',
    ],
    web: ['httpGet', 'httpPost'],
    shell: ['execCommand'],
    scheduler: ['scheduleTask', 'listScheduledTasks', 'cancelTask'],
    knowledge: ['searchKnowledge', 'indexDocument', 'queryDocument', 'clearDocumentIndex'],
    evaluation: ['evaluateQuality'],
    lsp: ['workspaceSymbols', 'goToDefinition', 'findReferences', 'diagnostics'],
  };
  const permitted = new Set<string>();
  for (const area of allowed) {
    for (const key of areaMap[area] ?? []) permitted.add(key);
  }
  const filtered: Record<string, unknown> = {};
  for (const key of permitted) {
    if (key in all) filtered[key] = (all as any)[key];
  }
  return filtered as typeof all;
}
