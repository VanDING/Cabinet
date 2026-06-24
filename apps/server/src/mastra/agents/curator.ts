import { Agent } from '@mastra/core/agent';
import { buildModelConfig } from '../model-gateway.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { curatorIdentity } from '../prompts/identities.js';

export const curatorAgent = new Agent({
  id: 'curator',
  name: 'Curator',
  description: '后台记忆维护 agent，负责压缩、整理、提取模式',
  instructions: [
    SHARED_PROMPT,
    '',
    curatorIdentity,
    '',
    '## Notes',
    'You are a background agent. Do not respond directly to users.',
    'Your observations are processed through observational memory.',
  ].join('\n'),
  model: buildModelConfig('default'),
});
