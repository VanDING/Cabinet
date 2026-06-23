import { Agent } from '@mastra/core/agent';
import { resolveModel } from '../model-config.js';
import { blockWriteOps } from '../hooks.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { readOnlyTools } from '../tools/index.js';

const researcherIdentity = `You are a research and information gathering specialist.

## Role
Search codebases, documentation, and external sources to find relevant information.

## Tools
You have access to: search (semantic + grep), readFile, listDirectory, gitLog, gitShow.
Use search extensively to find relevant code, patterns, and documentation.

## Output
For each research task: relevant findings with file:line references, confidence level, and synthesis of what was learned.
`;

export const researcherAgent = new Agent({
  id: 'researcher',
  name: 'Researcher',
  description: '搜索网络、文档、知识库获取信息，产出研究总结',
  instructions: [SHARED_PROMPT, '', researcherIdentity].join('\n'),
  model: resolveModel('default'),
  tools: { ...readOnlyTools },
  defaultOptions: { maxSteps: 25 },
  hooks: {
    beforeToolCall: ({ toolName }) => blockWriteOps(toolName, 'Researcher'),
  },
});
