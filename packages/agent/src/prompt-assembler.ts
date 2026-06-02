import { ToolExecutor } from './tool-executor.js';
import { SHARED_PROMPT } from './prompt-shared.js';

export interface PromptModules {
  identity: string;
  workflow?: string;
}

export interface AssembleOptions {
  modules: PromptModules;
  toolExecutor: ToolExecutor;
  dynamicContext?: string;
}

export function assemblePrompt(options: AssembleOptions): string {
  const toolsSection = buildToolsSection(options.toolExecutor);

  const sections: string[] = [
    SHARED_PROMPT,
    '',
    options.modules.identity,
  ];

  if (toolsSection) {
    sections.push('', toolsSection);
  }

  if (options.modules.workflow) {
    sections.push('', options.modules.workflow);
  }

  if (options.dynamicContext) {
    sections.push('', options.dynamicContext);
  }

  return sections.join('\n');
}

function buildToolsSection(executor: ToolExecutor): string {
  const descriptors = executor.getToolDescriptors();
  if (descriptors.length === 0) return '';
  const lines = descriptors.map((t) => `- ${t.name}: ${t.description}`);
  return `## Available Tools\n${lines.join('\n')}`;
}
