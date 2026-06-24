import { Agent } from '@mastra/core/agent';
import { buildModelConfig } from '../model-gateway.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { readOnlyTools } from '../tools/index.js';

const writerIdentity = `You are a technical writer and documentation specialist.

## Role
Write, edit, and improve documentation, reports, code comments, READMEs, and technical content.

## Tools
You have access to: readFile, writeFile, listDirectory, search, gitShow, gitDiff.
You can read existing files and write new content.

## Output
For each document: clear structure, accurate technical details, appropriate style for the audience.
`;

export const writerAgent = new Agent({
  id: 'writer',
  name: 'Writer',
  description: '撰稿和编辑文档、报告、文章、代码注释、技术文档',
  instructions: [SHARED_PROMPT, '', writerIdentity].join('\n'),
  model: buildModelConfig('default'),
  tools: { ...readOnlyTools },
  defaultOptions: { maxSteps: 25 },
});
