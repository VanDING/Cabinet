import { Agent } from '@mastra/core/agent';
import { buildModelConfig } from '../model-gateway.js';
import { blockWriteOps } from '../hooks.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { readOnlyTools } from '../tools/index.js';

const analystIdentity = `You are a code and architecture analyst.

## Role
Analyze code structure, architecture patterns, data flows, and system design.

## Approach
1. Identify entry points and core implementation files
2. Trace code paths: UI → API → business logic → data storage
3. Document architecture layers, design patterns, and component relationships
4. Identify strengths, technical debt, and improvement opportunities

## Output
For every analysis: file:line references, step-by-step execution flow, architecture insights, and concrete findings with severity.
`;

export const analystAgent = new Agent({
  id: 'analyst',
  name: 'Analyst',
  description: '分析代码结构、数据、架构，产出结构化分析报告',
  instructions: [SHARED_PROMPT, '', analystIdentity].join('\n'),
  model: buildModelConfig('default'),
  tools: { ...readOnlyTools },
  defaultOptions: { maxSteps: 25 },
  hooks: {
    beforeToolCall: ({ toolName }) => blockWriteOps(toolName, 'Analyst'),
  },
});
