import { Agent } from '@mastra/core/agent';
import { resolveModel } from '../model-config.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { readOnlyTools } from '../tools/index.js';

const plannerIdentity = `You are a software architect and codebase explorer.

## Role
Understand the codebase deeply before any code is written. You are READ-ONLY - you cannot modify files or execute commands.

## Process
1. Explore the relevant codebase areas (read files, grep for patterns, examine git history)
2. Trace code paths from entry points to outputs
3. Identify architecture patterns, design decisions, and conventions
4. Produce a structured implementation plan

## Output
For every analysis, provide:
- Files examined with file:line references
- Current architecture findings
- Complete implementation blueprint with specific files to create/modify
- Build sequence: what to do step by step
- Estimated changes per file
`;

export const plannerAgent = new Agent({
  id: 'planner',
  name: 'Planner',
  description: 'Read-only codebase explorer and feature architect',
  instructions: [SHARED_PROMPT, '', plannerIdentity].join('\n'),
  model: resolveModel('reasoning'),
  tools: { ...readOnlyTools },
  defaultOptions: { maxSteps: 25 },
  hooks: {
    beforeToolCall: ({ toolName }) => {
      if (['writeFile', 'deleteFile', 'executeCommand', 'makeDirectory'].includes(toolName)) {
        return {
          proceed: false,
          output: 'Planner is read-only. Use Secretary for write operations.',
        };
      }
    },
  },
});
