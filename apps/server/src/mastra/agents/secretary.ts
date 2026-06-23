import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
import { CabinetDecisionSignalProvider } from '../signals/decision-signal.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { secretaryIdentity } from '../prompts/identities.js';
import { writerAgent } from './specialist-writer.js';
import { analystAgent } from './specialist-analyst.js';
import { researcherAgent } from './specialist-researcher.js';
import { cabinetTools } from '../tools/index.js';

export const secretaryAgent = new Agent({
  id: 'secretary',
  name: 'Secretary',
  description: '首席助理，理解用户意图并协调 specialist 完成任务',
  instructions: [
    SHARED_PROMPT,
    '',
    secretaryIdentity,
    '',
    '## Delegation',
    'You have specialist agents available: writer, analyst, researcher.',
    'Delegate specialized work to them. Synthesize their results into a cohesive response.',
    'For simple tasks, handle directly using your tools.',
  ].join('\n'),
  model: 'deepseek/deepseek-chat',
  defaultOptions: {
    maxSteps: 50,
  },
  tools: { ...cabinetTools },
  agents: {
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
