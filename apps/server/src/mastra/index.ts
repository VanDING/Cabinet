import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { secretaryAgent } from './agents/secretary.js';
import { curatorAgent } from './agents/curator.js';
import { processFilesWorkflow } from './workflows/process-files.js';

const memory = new Memory({
  options: {
    lastMessages: 20,
    observationalMemory: true,
    semanticRecall: true,
  },
});

secretaryAgent.__setMemory(memory);
curatorAgent.__setMemory(memory);

export const mastra = new Mastra({
  agents: {
    secretary: secretaryAgent,
    curator: curatorAgent,
  },
  workflows: {
    processFiles: processFilesWorkflow,
  },
});

export { secretaryAgent, curatorAgent, processFilesWorkflow };
