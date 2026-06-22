import { tool, ToolLoopAgent, isStepCount } from 'ai';
import { z } from 'zod';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { WorkflowNodeDef } from '@cabinet/types';

function createSubagent(instructions: string): ToolLoopAgent<any, any> {
  return new ToolLoopAgent<any, any>({
    model: createDeepSeek()('deepseek-chat'),
    instructions,
    stopWhen: isStepCount(20),
  });
}

export function dagToSubagentTools(nodes: WorkflowNodeDef[]): Record<string, any> {
  const subagentTools: Record<string, any> = {};

  for (const node of nodes) {
    const toolName = `execute_node_${node.id}`;

    subagentTools[toolName] = tool({
      description: node.description
        ? `Execute DAG node "${node.title || node.id}": ${node.description}`
        : `Execute DAG node "${node.title || node.id}"`,

      inputSchema: z.object({
        context: z.string().optional().describe('Input context from previous nodes or user'),
      }),

      execute: async ({ context }: { context?: string }, { abortSignal }: any) => {
        const agent = createSubagent(
          node.systemPrompt || `Execute the node: ${node.title || node.id}`,
        );

        const result = await (agent.generate as any)({
          prompt: context
            ? context
            : node.prompt
              ? `${node.prompt}\n\n${JSON.stringify(node)}`
              : `Execute DAG node "${node.title || node.id}"`,
          abortSignal,
        });

        return result.text;
      },
    });
  }

  return subagentTools;
}

export function dagToFlowDescription(nodes: WorkflowNodeDef[]): string {
  if (nodes.length === 0) return '';

  const lines = nodes.map((node, idx) => {
    const deps = (node as any).dependsOn as string[] | undefined;
    const depStr = deps?.length ? ` (depends on: ${deps.join(', ')})` : '';
    return `${idx + 1}. "${node.title || node.id}"${depStr}`;
  });

  return [
    '## DAG Workflow',
    'Execute the following nodes in order, respecting dependencies:',
    ...lines,
    '',
    'Use the execute_node_* tools to run each node.',
    'Pass context from one node to the next via the context parameter.',
  ].join('\n');
}
