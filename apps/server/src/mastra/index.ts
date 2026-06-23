import { Mastra } from '@mastra/core';
import { secretaryAgent } from './agents/secretary.js';
import { curatorAgent } from './agents/curator.js';
import { processFilesWorkflow } from './workflows/process-files.js';

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
