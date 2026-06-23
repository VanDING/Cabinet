import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import {
  Observability,
  MastraStorageExporter,
  SensitiveDataFilter,
  SamplingStrategyType,
} from '@mastra/observability';
import { secretaryAgent } from './agents/secretary.js';
import { curatorAgent } from './agents/curator.js';
import { writerAgent } from './agents/specialist-writer.js';
import { analystAgent } from './agents/specialist-analyst.js';
import { researcherAgent } from './agents/specialist-researcher.js';
import { plannerAgent } from './agents/specialist-planner.js';
import { reviewerAgent } from './agents/specialist-reviewer.js';
import { testerAgent } from './agents/specialist-tester.js';
import { processFilesWorkflow } from './workflows/file-process.js';
import { codeReviewWorkflow } from './workflows/code-review.js';
import { parallelWorkflow } from './workflows/parallel-example.js';
import { cabinetWorkspace } from './workspace.js';
import { bgTaskManager } from './background-tasks.js';

const storage = new LibSQLStore({
  id: 'cabinet-storage',
  url: 'file:./data/cabinet.db',
});

const vector = new LibSQLVector({
  id: 'cabinet-vector',
  url: 'file:./data/cabinet-vector.db',
});

const embedder = (() => {
  try {
    return new ModelRouterEmbeddingModel('openai/text-embedding-3-small');
  } catch {
    console.warn('[Mastra] No embedding model configured. Vector search disabled.');
    return undefined;
  }
})();

const memory = new Memory({
  storage,
  vector,
  ...(embedder ? { embedder } : {}),
  options: {
    lastMessages: 20,
    observationalMemory: {
      model: 'deepseek/deepseek-chat',
      scope: 'thread',
      observation: {
        messageTokens: 30_000,
        bufferTokens: 0.2,
      },
    },
    workingMemory: {
      enabled: true,
      scope: 'resource',
      template: `# Project Context
- Current Project:
- User Goals:
- Last Tasks:
- Important Decisions:
`,
    },
    semanticRecall: embedder
      ? {
          topK: 5,
          messageRange: 2,
          scope: 'thread',
        }
      : undefined,
  },
});

(secretaryAgent as any).memory = memory;
(curatorAgent as any).memory = memory;
(writerAgent as any).memory = memory;
(analystAgent as any).memory = memory;
(plannerAgent as any).memory = memory;
(reviewerAgent as any).memory = memory;
(testerAgent as any).memory = memory;
(researcherAgent as any).memory = memory;

export const mastra = new Mastra({
  storage,
  workspace: cabinetWorkspace,
  agents: {
    secretary: secretaryAgent,
    curator: curatorAgent,
    writer: writerAgent,
    analyst: analystAgent,
    researcher: researcherAgent,
    planner: plannerAgent,
    reviewer: reviewerAgent,
    tester: testerAgent,
  },
  workflows: {
    processFiles: processFilesWorkflow,
    codeReview: codeReviewWorkflow,
    parallelExample: parallelWorkflow,
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'cabinet',
        sampling: { type: SamplingStrategyType.RATIO, probability: 0.1 },
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

bgTaskManager.__registerMastra(mastra as any);

export {
  secretaryAgent,
  curatorAgent,
  plannerAgent,
  reviewerAgent,
  testerAgent,
  writerAgent,
  analystAgent,
  researcherAgent,
  processFilesWorkflow,
  codeReviewWorkflow,
  parallelWorkflow,
  memory,
  bgTaskManager,
};
