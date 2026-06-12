import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createReviewTools(_deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Review Tools (interactive mode)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'present_for_review',
      description:
        'Present your completed blueprint for user review. Call this after finishing the design phase. The user will review and provide feedback before deployment. Do NOT deploy until the user approves.',
      parameters: {
        type: 'object',
        properties: {
          blueprint: {
            type: 'object',
            description:
              'The complete blueprint JSON with meta, agents, workflow, harness, and authorization fields',
          },
          summary: {
            type: 'string',
            description: 'A human-readable summary of what was designed and why',
          },
        },
        required: ['blueprint', 'summary'],
      },
      execute: async (args: Record<string, unknown>) => {
        const blueprint = args.blueprint;
        const summary = (args.summary as string) ?? 'Blueprint ready for review.';
        return JSON.stringify({
          status: 'presented_for_review',
          message: `Blueprint presented for review. ${summary}\n\nPlease review and respond with feedback (e.g., "change X", "add Y"), or "approved" to deploy, or "cancel" to discard.`,
          blueprint,
        });
      },
    },
  ];
}
