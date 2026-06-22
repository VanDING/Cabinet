import { tool } from 'ai';
import { z } from 'zod';
import { createCabinetTools } from './tools/index.js';
import type { ToolDependencies } from './tools/tool-dependencies.js';

export function createSdkTools(deps: ToolDependencies): any {
  const definedTools = createCabinetTools(deps);
  const sdkTools: any = {};

  for (const t of definedTools) {
    try {
      sdkTools[t.name] = tool({
        description: t.description ?? '',
        inputSchema: z.object({}).passthrough(),
        execute: async (args: Record<string, unknown>) => {
          return t.execute(args);
        },
      });
    } catch {
      // skip tools that fail to convert
    }
  }

  return sdkTools;
}
