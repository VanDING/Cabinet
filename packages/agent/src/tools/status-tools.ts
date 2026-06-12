import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createStatusTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Status/Health Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_status',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        const metrics = deps.getSystemMetrics();
        return {
          status: 'operational',
          timestamp: new Date().toISOString(),
          toolsAvailable: 42,
          metrics,
        };
      },
    },
    {
      name: 'get_dashboard_stats',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return deps.getDashboardStats();
      },
    },

    {
      name: 'get_memory_stats',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        const shortTermCount = deps.shortTerm.size?.() ?? 0;
        const longTermCount = (deps.longTerm as any).size?.() ?? 0;
        return {
          shortTerm: { count: shortTermCount },
          longTerm: { count: longTermCount },
        };
      },
    },
  ];
}
