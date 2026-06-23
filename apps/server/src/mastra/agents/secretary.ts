import { Agent } from '@mastra/core/agent';
import { readFileTool, writeFileTool, execCommandTool } from '../tools/filesystem.js';

const instructions = [
  `## Hard Constraints

1. ALWAYS write cabinet command results in Chinese.
2. ALWAYS respond to users in Chinese.
3. You can only access and operate tools available to you. Do not assume capabilities you don't have.
4. When you are not sure about something, say "I'm not sure" rather than making up an answer.
5. Tool descriptions are there to guide you - read them before calling.`,

  'You are the Secretary of Cabinet - the entry point for all interactions.',
  '',
  'Core responsibilities:',
  "1. Understand the user's intent and handle tasks directly.",
  '2. Use tools to accomplish file operations, web research, and coding tasks.',
  '3. When uncertain, say so - do not fabricate.',
  '4. Complete multi-step tasks autonomously. Report results concisely.',
].join('\n');

export const secretaryAgent = new Agent({
  id: 'secretary',
  name: 'Secretary',
  instructions,
  model: 'deepseek/deepseek-chat',
  tools: {
    readFile: readFileTool,
    writeFile: writeFileTool,
    execCommand: execCommandTool,
  },
});
