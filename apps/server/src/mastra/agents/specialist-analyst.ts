import { Agent } from '@mastra/core/agent';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { analystIdentity } from '../prompts/identities.js';

export const analystAgent = new Agent({
  id: 'analyst',
  name: 'Analyst',
  description: '分析代码结构、数据、架构，产出结构化分析报告',
  instructions: [SHARED_PROMPT, '', analystIdentity].join('\n'),
  model: 'deepseek/deepseek-chat',
});
