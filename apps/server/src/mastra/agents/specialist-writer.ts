import { Agent } from '@mastra/core/agent';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { writerIdentity } from '../prompts/identities.js';

export const writerAgent = new Agent({
  id: 'writer',
  name: 'Writer',
  description: '撰稿和编辑文档、报告、文章、代码注释、技术文档',
  instructions: [SHARED_PROMPT, '', writerIdentity].join('\n'),
  model: 'deepseek/deepseek-chat',
});
