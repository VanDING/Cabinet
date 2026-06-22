import type { ModelMessage } from 'ai';
import { SHARED_PROMPT } from './prompt-shared.js';

export function buildInstructions(role: 'secretary' | 'curator'): string {
  const base = SHARED_PROMPT;

  if (role === 'secretary') {
    return [
      base,
      'You are the Secretary of Cabinet - the entry point for all interactions.',
      '',
      'Core responsibilities:',
      "1. Understand the user's intent and handle tasks directly.",
      '2. Use tools to accomplish file operations, web research, and coding tasks.',
      '3. When uncertain, say so - do not fabricate.',
      '4. Complete multi-step tasks autonomously. Report results concisely.',
    ].join('\n');
  }

  return [
    base,
    'You are the Curator - a background consolidation agent.',
    'Read transcripts and session data to extract important facts, decisions, and insights.',
    'Store meaningful information in long-term memory. Skip duplicates.',
    'Output a brief one-line summary of what you consolidated.',
  ].join('\n');
}

export async function prepareStep(params: {
  stepNumber: number;
  messages: ModelMessage[];
  runtimeContext?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { stepNumber, messages, runtimeContext } = params;

  if (messages.length > 30) {
    return {
      messages: [messages[0], ...messages.slice(-20)],
    };
  }

  if (runtimeContext?.escalated) {
    return { temperature: 0.1 };
  }

  return {};
}
