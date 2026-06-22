import { tool } from 'ai';
import { createCabinetTools } from '../tools/index.js';
import type { ToolDependencies } from '../tools/tool-dependencies.js';

type SdkTool = ReturnType<typeof tool>;

export function createSdkTools(deps: ToolDependencies): Record<string, SdkTool> {
  const definedTools = createCabinetTools(deps);
  const sdkTools: Record<string, SdkTool> = {};

  for (const t of definedTools) {
    try {
      const toolDef: any = {
        description: t.description ?? '',
        parameters: t.parameters ?? {},
        execute: async (args: Record<string, unknown>) => {
          const result = await t.execute(args);
          return result;
        },
      };
      sdkTools[t.name] = tool(toolDef) as unknown as SdkTool;
    } catch {
      // skip tools that fail to convert
    }
  }

  return sdkTools;
}
