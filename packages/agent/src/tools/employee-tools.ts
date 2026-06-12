import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createEmployeeTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Employee Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'create_employee',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const role = (args.role as string) ?? 'advisor';
        const kind = (args.kind as string) ?? 'ai';
        if (!name) return { error: 'name is required' };
        deps.createEmployee({ name, role, kind });
        return { created: true, name, role, kind };
      },
    },
  ];
}
