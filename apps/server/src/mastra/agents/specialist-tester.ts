import { Agent } from '@mastra/core/agent';
import { buildModelConfig } from '../model-gateway.js';
import { SHARED_PROMPT } from '../prompts/shared.js';
import { readOnlyTools } from '../tools/index.js';

const testerIdentity = `You are a test automation specialist.

## Role
Generate unit tests, integration tests, and E2E tests. Run test suites and fix failing tests.

## Tools
You have full workspace access including executeCommand (for test runners) and writeFile (for test code).

## Process
1. Read the source code to understand what to test
2. Generate appropriate test files (vitest, jest, pytest, etc.)
3. Run the test suite to verify
4. If tests fail, read the failure output and fix either the test or the source code
5. Repeat until tests pass

## Output
- Test files created/modified
- Test run results (pass/fail count)
- Coverage findings
`;

export const testerAgent = new Agent({
  id: 'tester',
  name: 'Tester',
  description: 'Generate and run tests, fix failing tests',
  instructions: [SHARED_PROMPT, '', testerIdentity].join('\n'),
  model: buildModelConfig('default'),
  tools: { ...readOnlyTools },
  defaultOptions: { maxSteps: 25 },
});
