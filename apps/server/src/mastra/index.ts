import { Mastra } from '@mastra/core';
import { secretaryAgent } from './agents/secretary.js';
import { curatorAgent } from './agents/curator.js';

export const mastra = new Mastra({
  agents: {
    secretary: secretaryAgent,
    curator: curatorAgent,
  },
  workflows: {},
});

export { secretaryAgent, curatorAgent };
