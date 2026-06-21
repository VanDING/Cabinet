# Prompt Modular Assembly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace monolithic `systemPrompt` strings with modular prompt assembly — shared rules extracted, tools auto-generated, constraints graded with `[HARD]` markers.

**Architecture:** Two new files (`prompt-shared.ts`, `prompt-assembler.ts`) in `packages/agent/`. `assemblePrompt()` composes prompts from five layers: shared rules → identity → auto-generated tools → workflow → dynamic context. AgentRole's `systemPrompt: string` replaced by `modules: { identity, workflow? }`. All call sites switched from reading `role.systemPrompt` to calling `assemblePrompt()`.

**Tech Stack:** TypeScript 5.9, Vitest 4.x

---

### Task 1: Shared rules extraction

**Files:**

- Create: `packages/agent/src/prompt-shared.ts`

- [ ] **Step 1: Create prompt-shared.ts**

```typescript
// packages/agent/src/prompt-shared.ts
export const SHARED_PROMPT = `## Hard Constraints
[HARD] Never route user messages to Reviewer or Curator — they are background agents.
[HARD] Only use Markdown formatting. Never output raw HTML tags.
[HARD] Only include content based on actual analysis. Do not fabricate data, copy example values, or output placeholder text. An empty or minimal result is better than a fabricated one.

## Guidelines
- Present options with trade-offs, not just recommendations.
- When uncertain, say so rather than fabricate.
- Maintain continuity by referencing past decisions and context.
- After tool results, synthesize a complete answer — never just a one-line status.
- Continue multi-step tasks until fully complete.

If you are unsure about system capabilities, data directories, or the responsibilities of other agents, use query_system_knowledge to look up the information.`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/src/prompt-shared.ts
git commit -m "feat(agent): extract shared prompt rules from role definitions"
```

---

### Task 2: Prompt assembler + tests

**Files:**

- Create: `packages/agent/src/prompt-assembler.ts`
- Create: `packages/agent/src/__tests__/prompt-assembler.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/prompt-assembler.test.ts
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../prompt-assembler.js';
import { ToolExecutor } from '../tool-executor.js';

describe('assemblePrompt', () => {
  function makeExecutor(tools: { name: string; description: string }[]) {
    const ex = new ToolExecutor();
    for (const t of tools) {
      ex.register({ name: t.name, description: t.description, execute: async () => null });
    }
    return ex;
  }

  it('includes shared rules, identity, and tools', () => {
    const result = assemblePrompt({
      modules: { identity: 'You are a test agent.' },
      toolExecutor: makeExecutor([
        { name: 'read', description: 'Read a file' },
        { name: 'write', description: 'Write a file' },
      ]),
    });

    expect(result).toContain('Hard Constraints');
    expect(result).toContain('You are a test agent.');
    expect(result).toContain('## Available Tools');
    expect(result).toContain('- read: Read a file');
    expect(result).toContain('- write: Write a file');
  });

  it('includes optional workflow section', () => {
    const result = assemblePrompt({
      modules: {
        identity: 'You are a test agent.',
        workflow: '## Routing\nRoute to X for Y.',
      },
      toolExecutor: makeExecutor([]),
    });

    expect(result).toContain('## Routing');
    expect(result).toContain('Route to X for Y.');
  });

  it('includes dynamic context when provided', () => {
    const result = assemblePrompt({
      modules: { identity: 'Test.' },
      toolExecutor: makeExecutor([]),
      dynamicContext: 'Project: Alpha\nCaptain: dotty',
    });

    expect(result).toContain('Project: Alpha');
    expect(result).toContain('Captain: dotty');
  });

  it('module order: shared → identity → tools → workflow → context', () => {
    const result = assemblePrompt({
      modules: {
        identity: 'IDENTITY_MARKER',
        workflow: 'WORKFLOW_MARKER',
      },
      toolExecutor: makeExecutor([]),
      dynamicContext: 'CONTEXT_MARKER',
    });

    const idxShared = result.indexOf('Hard Constraints');
    const idxIdentity = result.indexOf('IDENTITY_MARKER');
    const idxTools = result.indexOf('## Available Tools');
    const idxWorkflow = result.indexOf('WORKFLOW_MARKER');
    const idxContext = result.indexOf('CONTEXT_MARKER');

    expect(idxShared).toBeLessThan(idxIdentity);
    expect(idxIdentity).toBeLessThan(idxTools);
    expect(idxTools).toBeLessThan(idxWorkflow);
    expect(idxWorkflow).toBeLessThan(idxContext);
  });

  it('tools section empty when no tools registered', () => {
    const result = assemblePrompt({
      modules: { identity: 'Test.' },
      toolExecutor: makeExecutor([]),
    });

    expect(result).toContain('## Available Tools');
    // No tool lines after the header
  });

  it('does not include workflow or context when absent', () => {
    const result = assemblePrompt({
      modules: { identity: 'Test.' },
      toolExecutor: makeExecutor([]),
    });

    // The assembled prompt should not have trailing empty sections
    expect(result).not.toMatch(/WORKFLOW_MARKER/);
    expect(result).not.toMatch(/CONTEXT_MARKER/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run --reporter=verbose prompt-assembler.test.ts
```

Expected: FAIL — "Cannot find module '../prompt-assembler.js'"

- [ ] **Step 3: Implement assemblePrompt**

```typescript
// packages/agent/src/prompt-assembler.ts
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

  const sections: string[] = [SHARED_PROMPT, '', options.modules.identity];

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agent && npx vitest run --reporter=verbose prompt-assembler.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/agent && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/prompt-assembler.ts packages/agent/src/__tests__/prompt-assembler.test.ts
git commit -m "feat(agent): add prompt assembler with auto-generated tool section"
```

---

### Task 3: Migrate 5 AgentRoles from systemPrompt to modules

**Files:**

- Modify: `packages/agent/src/agent-roles.ts`

- [ ] **Step 1: Update AgentRole type**

Replace `systemPrompt: string` with `modules: { identity: string; workflow?: string }`:

```typescript
// packages/agent/src/agent-roles.ts — line ~32
// Before:
  systemPrompt: string;

// After:
  modules: {
    identity: string;
    workflow?: string;
  };
```

- [ ] **Step 2: Migrate SECRETARY_ROLE**

Replace the `systemPrompt: [...]` block (lines 62-126) with:

```typescript
  modules: {
    identity: [
      'You are the Secretary of Cabinet — the entry point for all Captain interactions.',
      '',
      'Core responsibilities:',
      "1. Understand the Captain's intent. Handle general questions directly.",
      '2. For specialized tasks, route to the appropriate cabinet member (MeetingChair, Organize, or any custom agent).',
      '3. The routing system suggests the best agent — trust it for clear-cut cases, override when you see a better fit.',
    ].join('\n'),
    workflow: [
      '## Routing Rules',
      'Route to meeting_chair: meeting organization with multiple perspectives (开会/召集会议/组织讨论).',
      'Route to organize: workflow design, agent creation, skill writing, MCP building, system architecture design.',
      'Handle yourself: general questions, code review, file review, analysis.',
      '',
      '## Decision Analysis Mode',
      'When asked for decision analysis (权衡/选择/决策):',
      '1. Frame the real question. 2. Expand options. 3. Evaluate across cost, risk, time, reversibility, strategic fit.',
      '4. Assign authorization level (L0-L3). 5. Use create_decision tool. 6. Recommend with caveats, preserve Captain choice.',
      '',
      '## Development Workflow',
      'Edit code → Run tests → Read errors → Fix → Report summary when tests pass.',
      '',
      '## Session Start',
      '- Check short-term memory for a "session_brief". If present, present it as a context summary.',
      '',
      '## Web Access',
      'When asked about external information, current events, or documentation: use web_fetch. Do not guess or hallucinate.',
      '',
      '## Routing Feedback',
      'Watch for feedback after specialist responses:',
      '- Negative ("不对", "不是这个", "错了") → route was wrong, re-route.',
      '- Positive ("很好", "不错", "对的") → route was correct.',
      '',
      '## Inline Decision Markers',
      'Use [[DECISION:<decision_id>]] to render a decision card inline. Only after calling create_decision.',
    ].join('\n'),
  },
```

- [ ] **Step 3: Migrate MEETING_CHAIR_ROLE, CURATOR_ROLE, REVIEWER_ROLE, ORGANIZE_ROLE**

Same pattern: `systemPrompt` → `modules: { identity, workflow }`. Extract identity (who you are + core role) into `identity`. Everything procedural (routing rules, step-by-step methods, checklists) into `workflow`.

For **CURATOR_ROLE** (lines 263-317):

```typescript
  modules: {
    identity: [
      "You are the Curator of Cabinet — responsible for the system's memory and self-improvement.",
      '',
      'Your role:',
      '1. Summarize sessions, decisions, and project progress.',
      '2. Consolidate important information from short-term to long-term memory.',
      '3. Extract patterns from decision history — recurring preferences, risk tolerances, priorities.',
      '4. Prepare context briefs for new sessions.',
      '',
      'Be thorough but concise. A good summary captures what happened, what was decided, and what remains open.',
      'Pattern extraction should be evidence-based: cite specific decisions, not vague impressions.',
    ].join('\n'),
    workflow: [
      '## Memory Tools',
      '- search_memory: find relevant past context',
      '- write_memory: persist important findings to long-term memory',
      '- update_project_summary: keep project overview current',
      '- add_milestone: mark significant achievements',
    ].join('\n'),
  },
```

For **REVIEWER_ROLE** (lines 319-384):

```typescript
  modules: {
    identity: [
      'You are the Reviewer — an independent quality gate for agent outputs in Cabinet.',
      '',
      'Your role: review output from other agents. Check for: logical completeness, risk assessment adequacy,',
      'weak evidence, unstated assumptions, factual errors. Use tools to verify claims.',
      '',
      'Do NOT perform analysis yourself — only review what was provided.',
      '',
      'Guidelines:',
      '- Be specific and actionable. "The analysis is weak" is not helpful.',
      '- If you fail output, issues must be specific enough for the original agent to fix.',
      '- Use tools proactively to verify claims.',
      '- Do not add your own analysis. Only review.',
      '- If the same issues persist after 2+ rounds, escalate.',
    ].join('\n'),
    workflow: [
      '## Output Format',
      'Output as JSON:',
      '{"pass": boolean, "score": 0.0-1.0, "issues": [{',
      '  "type": "weak_evidence"|"logical_gap"|"unstated_assumption"|"factual_error",',
      '  "detail": "specific description",',
      '  "severity": "high"|"medium"|"low"',
      '}], "suggestion": {"action": "...", "detail": "..."}}',
      '',
      'Only include issues you actually found. Empty "issues" array is fine.',
    ].join('\n'),
  },
```

For **MEETING_CHAIR_ROLE** (lines 213-261):

```typescript
  modules: {
    identity: [
      'You are the Meeting Chair of Cabinet — you coordinate analysis, you do not perform analysis yourself.',
      '',
      'Your role:',
      '1. Parse the user intent and identify what perspectives are needed.',
      '2. Select relevant perspectives and specify what each should focus on.',
      '3. Construct a structured Brief for analysis.',
      '4. When you receive Reviewer feedback, route issues to the relevant perspective.',
      '5. When analysis passes review, generate a deliverable for the Captain.',
      '',
      'Key principles:',
      '- You coordinate. The Advisor analyzes. The Reviewer reviews. Each has one job.',
      '- Be specific when constructing the Brief — not "analyze the market" but "analyze market entry barriers in the EU."',
      '- Do not add your own analysis.',
      '- Use get_project_context to load current project state.',
    ].join('\n'),
    workflow: [
      '## Brief Format',
      'Output as JSON:',
      '{"selected_perspectives": [{"id": "...", "name": "...", "focus": "..."}],',
      ' "topic_refined": "...", "key_questions": ["..."]}',
    ].join('\n'),
  },
```

For **ORGANIZE_ROLE** (lines 387-568) — preserve the six-step method in workflow, trim identity:

```typescript
  modules: {
    identity: [
      'You are the Organize Agent — the Chief Organization Architect of Cabinet.',
      '',
      "Your mission: translate the Captain's fuzzy business goal into a concrete, executable organization blueprint.",
      '',
      'You are both the architect and the implementer. Default to direct implementation.',
      'Prefer reusing existing agents over creating new ones.',
      'Be proactive within safety boundaries — drive through steps, but always call create_decision for L2+ approval.',
      'When the goal is simple (single-agent, no new workflow), use the Simplified Path: Clarify → Design → Execute → Memorize.',
    ].join('\n'),
    workflow: [
      '## The Six-Step Method',
      '',
      '### Step 1: Clarify (探明需求)',
      '- Understand what the Captain really wants. Ask clarifying questions if vague.',
      '- Use recall, search_memory, get_project_context for context.',
      '- Confirm: what does success look like? Constraints?',
      '',
      '### Step 2: Design (设计方案)',
      '- Decompose the goal into capability requirements.',
      '- Use list_agents to find existing agents. For gaps: design new agents. Do NOT create yet.',
      '- Design workflow, quality gates, authorization rules (L2/L3 approval).',
      '- Design standards: call use_skill__workflowDesigner and use_skill__agentCreator for latest rules.',
      '- Verify: all capabilities covered, no overlapping responsibilities, no circular dependencies.',
      '',
      '### Step 3: Implementation Plan (实施方案)',
      '- Translate design into ordered tool calls: register agents → create workflow → await approval.',
      '- Identify risks and fallbacks.',
      '- Verify: dependencies resolved, workflow schema valid, tools compatible with safety tier.',
      '',
      '### Step 4: Execute (顺序执行)',
      '- Follow the plan step by step. Do NOT skip.',
      '- If a tool call fails, STOP. Report the failure.',
      '',
      '### Step 5: Activate, Test & Iterate (运行测试 + 回退)',
      '- Call run_workflow. Inspect result.',
      '- If design flaw → return to Step 2. If implementation flaw → return to Step 3.',
      '- Do NOT blindly retry without changing something.',
      '',
      '### Step 6: Memorize (写入记忆)',
      '- write_memory with importance ≥ 0.8: {type: "design_experience", goal, agents_created, workflow_id, lessons}.',
      '- Report final summary.',
      '',
      '## Agent Assignment Principles',
      '- Consecutive steps sharing domain = same agent. Execution agent ≠ approval agent (L2/L3).',
      '- Split parallel steps across agents with different competencies.',
      '- When uncertain: mark as design_decision for Captain.',
      '',
      '## Built-in Skills',
      '- use_skill__workflowDesigner — workflow design rules',
      '- use_skill__agentCreator — agent configuration rules',
      '- use_skill__skillCreator — skill authoring',
      '- use_skill__mcpBuilder — MCP server development',
      '',
      '## Blueprint Output',
      'Present in plain language, then as structured JSON:',
      '{goal, agents: [...], workflow: [...], qualityGates: [...], authorization: [...], designDecisions: [...]}',
    ].join('\n'),
  },
```

- [ ] **Step 4: Build to verify compilation fails due to missing systemPrompt references**

```bash
cd packages/agent && npx tsc --noEmit 2>&1 | head -15
```

Expected: TypeScript errors about `systemPrompt` not existing on AgentRole — these point to the exact lines that need updating in Tasks 4-6.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/agent-roles.ts
git commit -m "refactor(agent): migrate 5 AgentRoles from systemPrompt to modules"
```

---

### Task 4: Update ContextBuilder

**Files:**

- Modify: `packages/agent/src/context-builder.ts`
- Modify: `packages/agent/src/agent-loop.ts` (ContextBuilder construction sites)

- [ ] **Step 1: Add toolExecutor to ContextBuilder constructor**

```typescript
// packages/agent/src/context-builder.ts — line ~69-70
// Before:
  constructor(private readonly memory: MemoryProvider) {}

// After:
  constructor(
    private readonly memory: MemoryProvider,
    private readonly toolExecutor: ToolExecutor,
  ) {}
```

Add import at top:

```typescript
import type { ToolExecutor } from './tool-executor.js';
```

- [ ] **Step 2: Update buildDefaultSystemPrompt to use assemblePrompt**

Replace the `buildDefaultSystemPrompt` method (lines 286-302) to accept `PromptModules` instead of a raw string:

```typescript
// packages/agent/src/context-builder.ts — line ~286
// Before: buildDefaultSystemPrompt takes projectContext, preferences, rules, roleSystemPrompt?
// After: accepts role from AgentRole and calls assemblePrompt
```

Actually, the simplest change: `buildDefaultSystemPrompt` currently receives `roleSystemPrompt?: string`. When `roleSystemPrompt` is undefined, it falls back to the hardcoded Tier 1 text (buildTier1Prompt). Now with modules, we pass `modules` instead.

The cleanest approach: add a `modules` parameter. When present, use `assemblePrompt()`. When absent, use legacy path.

```typescript
// packages/agent/src/context-builder.ts
// Add import:
import { assemblePrompt, type PromptModules } from './prompt-assembler.js';

// Add to ContextBuilderOptions:
export interface ContextBuilderOptions {
  // ... existing fields ...
  roleModules?: PromptModules; // NEW — for modular prompt assembly
}

// In build():
let systemPrompt: string;
if (options.systemPrompt && !options.roleSystemPrompt) {
  systemPrompt = options.systemPrompt; // legacy full-override
} else if (options.roleModules) {
  // Modular path
  systemPrompt = assemblePrompt({
    modules: options.roleModules,
    toolExecutor: this.toolExecutor,
    dynamicContext: projectContext
      ? `## Project Context\n${projectContext}\n\nCaptain preferences: ${this.stableStringify(preferences)}`
      : undefined,
  });
  // Inject rules
  if (rules.length > 0) {
    const rulesText = rules.map((r) => `<!-- rule: ${r.path} -->\n${r.content}`).join('\n\n');
    systemPrompt = `${systemPrompt}\n\n## Project Rules\n${rulesText}`;
  }
} else {
  systemPrompt = this.buildDefaultSystemPrompt(
    projectContext,
    preferences,
    rules,
    options.roleSystemPrompt,
  );
}
```

- [ ] **Step 3: Update AgentLoop to pass roleModules to ContextBuilderOptions**

```typescript
// packages/agent/src/agent-loop.ts — line ~293 (ContextBuilder construction)
// Before:
this.contextBuilder = new ContextBuilder(options.memoryProvider);

// After:
this.contextBuilder = new ContextBuilder(options.memoryProvider, options.toolExecutor);

// In run() — line ~409 (contextBuilder.build call):
// Add roleModules if available:
const ctx = await this.contextBuilder.build({
  // ... existing fields
  roleModules: this.options.roleModules, // NEW
});
```

Add to AgentLoopOptions:

```typescript
// packages/agent/src/agent-loop.ts — line ~76 (AgentLoopOptions)
roleModules?: import('./prompt-assembler.js').PromptModules;  // NEW
```

- [ ] **Step 4: Typecheck**

```bash
cd packages/agent && npx tsc --noEmit
```

Expected: fewer errors than Task 3 Step 4. Remaining errors are in agent-node.ts and dispatcher.ts.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/context-builder.ts packages/agent/src/agent-loop.ts
git commit -m "refactor(agent): integrate prompt assembler into ContextBuilder"
```

---

### Task 5: Update agent-node.ts

**Files:**

- Modify: `packages/agent/src/agent-node.ts`
- Modify: `packages/agent/src/__tests__/agent-node.test.ts`

- [ ] **Step 1: Replace role.systemPrompt with assemblePrompt in createAgentNodeFactory**

```typescript
// packages/agent/src/agent-node.ts — lines 34-38
// Before:
const { message, systemPrompt: override } = config.input(state);
const systemPrompt = override
  ? `${config.role.systemPrompt}\n\n${override}`
  : config.role.systemPrompt;

// After:
import { assemblePrompt } from './prompt-assembler.js'; // add at top

const { message, systemPrompt: override } = config.input(state);
let systemPrompt = assemblePrompt({
  modules: config.role.modules,
  toolExecutor: toolView,
});
if (override) {
  systemPrompt = `${systemPrompt}\n\n${override}`;
}
```

- [ ] **Step 2: Update test references**

```typescript
// packages/agent/src/__tests__/agent-node.test.ts — line ~131
// Before:
expect(capturedSystemPrompt).toContain(REVIEWER_ROLE.systemPrompt);

// After:
expect(capturedSystemPrompt).toContain(REVIEWER_ROLE.modules.identity);
```

- [ ] **Step 3: Run agent-node tests**

```bash
cd packages/agent && npx vitest run --reporter=verbose agent-node.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/agent-node.ts packages/agent/src/__tests__/agent-node.test.ts
git commit -m "refactor(agent): use prompt assembler in createAgentNodeFactory"
```

---

### Task 6: Update dispatcher.ts

**Files:**

- Modify: `packages/agent/src/dispatcher.ts`

- [ ] **Step 1: Replace role.systemPrompt with assemblePrompt in runAgentStep**

```typescript
// packages/agent/src/dispatcher.ts — add import:
import { assemblePrompt } from './prompt-assembler.js';

// Line ~350, replace:
  systemPrompt: role.systemPrompt,

// With:
  systemPrompt: this.assembleRolePrompt(role),
```

Add private helper method to AgentDispatcher:

```typescript
  private assembleRolePrompt(role: AgentRole): string {
    return assemblePrompt({
      modules: role.modules,
      toolExecutor: this.baseOptions.toolExecutor,
    });
  }
```

This requires `toolExecutor` to be available in `baseOptions`. It already is — `baseOptions` includes `toolExecutor`.

- [ ] **Step 2: Typecheck**

```bash
cd packages/agent && npx tsc --noEmit
```

Expected: No errors. All systemPrompt references resolved.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/dispatcher.ts
git commit -m "refactor(agent): use prompt assembler in dispatcher"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run all agent tests**

```bash
cd packages/agent && npx vitest run
```

Expected: All 78 + 6 new = 84 tests pass. Fix any failures.

- [ ] **Step 2: Cross-package verification**

```bash
cd packages/graph && npx vitest run && cd ../workflow && npx vitest run
```

Expected: graph 30 pass, workflow 33 pass — no regressions.

- [ ] **Step 3: Full typecheck**

```bash
cd packages/agent && npx tsc --noEmit && cd ../workflow && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: full verification after prompt modular assembly migration"
```

---

## Self-Review

**1. Spec coverage:**

- SHARED_PROMPT extraction → Task 1 ✓
- assemblePrompt() with tool auto-generation → Task 2 ✓
- AgentRole systemPrompt → modules migration → Task 3 ✓
- ContextBuilder integration → Task 4 ✓
- createAgentNodeFactory integration → Task 5 ✓
- Dispatcher integration → Task 6 ✓
- Full verification → Task 7 ✓

**2. Placeholder scan:** No TBD/TODO. All code concrete.

**3. Type consistency:**

- `PromptModules` defined in Task 2, used in Tasks 3-6 — consistent
- `assemblePrompt` signature: `(options: AssembleOptions) => string` — consistent across all tasks
- `AgentRole.modules` — `{ identity: string; workflow?: string }` per Task 3 — consistent
