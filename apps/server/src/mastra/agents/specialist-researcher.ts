import { Agent } from '@mastra/core/agent';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { researcherIdentity } from '../prompts/identities.js';

export const researcherAgent = new Agent({
  id: 'researcher',
  name: 'Researcher',
  description: '搜索网络、文档、知识库获取信息，产出研究总结',
  instructions: [SHARED_PROMPT, '', researcherIdentity].join('\n'),
  model: 'deepseek/deepseek-chat',
});
