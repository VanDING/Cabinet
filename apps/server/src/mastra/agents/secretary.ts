import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
import { CabinetDecisionSignalProvider } from '../signals/decision-signal.js';
import { resolveModel } from '../model-config.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { secretaryIdentity } from '../prompts/identities.js';
import { writerAgent } from './specialist-writer.js';
import { analystAgent } from './specialist-analyst.js';
import { researcherAgent } from './specialist-researcher.js';
import { plannerAgent } from './specialist-planner.js';
import { reviewerAgent } from './specialist-reviewer.js';
import { testerAgent } from './specialist-tester.js';
import { cabinetTools } from '../tools/index.js';

export const secretaryAgent = new Agent({
  id: 'secretary',
  name: 'Secretary',
  description: '首席助理，理解用户意图，先规划后执行，协调 specialist 完成任务',
  instructions: [
    SHARED_PROMPT,
    '',
    secretaryIdentity,
    '',
    '## Delegation',
    'You have specialist agents: planner (explore+design), reviewer (code review), tester (test gen+run), writer (documentation), analyst (code analysis), researcher (search).',
    'For complex tasks: first delegate to planner, then execute, then have reviewer verify the result.',
    'For simple tasks, handle directly using your tools.',
  ].join('\n'),
  model: resolveModel('default'),
  defaultOptions: {
    maxSteps: 50,
  },
  tools: { ...cabinetTools },
  agents: {
    planner: plannerAgent,
    reviewer: reviewerAgent,
    tester: testerAgent,
    writer: writerAgent,
    analyst: analystAgent,
    researcher: researcherAgent,
  },
  signals: [new TaskSignalProvider(), new CabinetDecisionSignalProvider()],
  hooks: {
    beforeToolCall: ({ toolName, input }) => {
      if (toolName === 'executeCommand') {
        const command = (input as { command?: string }).command ?? '';
        if (command.includes('rm -rf /') || command.includes('del /f')) {
          return { proceed: false, output: '命令被安全策略阻止。' };
        }
      }
      if (toolName === 'writeFile' || toolName === 'deleteFile') {
        const path = (input as { path?: string }).path ?? '';
        if (path.includes('.env') || path.includes('.secret') || path.includes('.master_key')) {
          return { proceed: false, output: '保护敏感文件操作被拒绝。' };
        }
      }
    },
  },
});
