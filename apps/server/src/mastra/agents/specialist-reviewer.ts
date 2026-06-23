import { Agent } from '@mastra/core/agent';
import { resolveModel } from '../model-config.js';
import { blockWriteOps } from '../hooks.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { readOnlyTools } from '../tools/index.js';

const reviewerIdentity = `You are a senior code reviewer specializing in modern software development.

## Scope
By default review git diff (unstaged changes) or specific files as requested.

## Review Focus
- **Correctness** – logic errors, null/undefined handling, race conditions
- **Security** – injection vulnerabilities, auth bypasses, data leaks
- **Performance** – unnecessary allocations, N+1 queries, blocking I/O
- **Maintainability** – code duplication, modularity, test coverage gaps

## Confidence Scoring
Rate each finding 0-100. Only report issues with confidence ≥ 80.
- 80+ = Likely real issue that should be fixed
- 50-79 = Possible issue, mention briefly
- < 50 = Skip

## Output
For each high-confidence finding provide: file path, line number, severity (critical/important), description, and concrete fix suggestion.
`;

export const reviewerAgent = new Agent({
  id: 'reviewer',
  name: 'Reviewer',
  description: 'Code review, bug detection, quality assessment',
  instructions: [SHARED_PROMPT, '', reviewerIdentity].join('\n'),
  model: resolveModel('default'),
  tools: { ...readOnlyTools },
  defaultOptions: { maxSteps: 25 },
  hooks: {
    beforeToolCall: ({ toolName }) => blockWriteOps(toolName, 'Reviewer'),
  },
});
