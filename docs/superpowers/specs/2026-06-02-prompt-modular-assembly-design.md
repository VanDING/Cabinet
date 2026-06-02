# Prompt Modular Assembly — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Scope:** Two new files in `packages/agent/` — `prompt-shared.ts` (shared rules), `prompt-assembler.ts` (assembly function). Migrate 5 AgentRole.systemPrompt fields from monolithic strings to `modules`.

## 1. Motivation

Current systemPrompt construction has six structural problems:

1. **Length bloat** — 5 roles total ~2600 lines of system prompt, loaded every turn. Secretary alone is 800 tokens.
2. **Footer duplication** — the same `query_system_knowledge` footer repeated identically in all 5 roles.
3. **Mixed concerns** — identity, tool listing, hard constraints, soft guidelines all in one undifferentiated string.
4. **Hand-maintained tool lists** — prompt text lists tools manually, guaranteed to drift from `allowedTools` arrays.
5. **No constraint grading** — "NEVER route to Reviewer" and "present options with trade-offs" have equal visual weight.
6. **Untestable** — prompt strings embedded in code constants, no way to unit test assembly logic.

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Migration path | Direct replacement — `systemPrompt: string` → `modules: { identity, workflow? }` | Clean break. No fallback logic to maintain. One-time migration of 5 roles. |
| Module schema | 4 fixed modules: shared (imported), identity (required), tools (auto-generated), workflow (optional) + dynamicContext (runtime) | Tools are never hand-written — always generated from ToolExecutor. Identity is the only required per-role field. |
| Shared rules location | Independent file `prompt-shared.ts` | Shared rules change rarely. Separate file means edits don't touch role definitions. Testable independently. |
| Tools source | `assemblePrompt()` receives the same `ToolExecutor` instance used by AgentLoop | If AgentLoop uses a filtered `createView()`, pass that same view to `assemblePrompt()`. Prompt lists exactly what the agent can actually use. |
| Constraint grading | `[HARD]` prefix on non-negotiable rules | Simple string prefix. No parser needed. Model research supports this pattern for constraint recognition. |

## 3. API

### 3.1 SHARED_PROMPT

```typescript
// packages/agent/src/prompt-shared.ts

export const SHARED_PROMPT: string;
```

Contains: hard constraints (`[HARD]` prefix), formatting rules, soft guidelines, and the system knowledge footer. All roles share this identically.

### 3.2 PromptModules (part of AgentRole)

```typescript
interface PromptModules {
  identity: string;       // required — 3-5 lines defining who this agent is
  workflow?: string;      // optional — domain-specific workflow instructions
}
```

### 3.3 assemblePrompt()

```typescript
// packages/agent/src/prompt-assembler.ts

interface AssembleOptions {
  modules: PromptModules;
  toolExecutor: ToolExecutor;       // the same (possibly filtered) instance AgentLoop uses
  dynamicContext?: string;          // runtime: project name, captain prefs, etc.
}

function assemblePrompt(options: AssembleOptions): string;
```

Assembly order:
```
SHARED_PROMPT
↓
identity ("You are the Secretary...")
↓
tools (auto-generated from toolExecutor.getToolDescriptors())
↓
workflow (if present — routing rules, decision mode, etc.)
↓
dynamicContext (if present — project context, captain preferences)
```

### 3.4 AgentRole type change

```typescript
// Before
interface AgentRole {
  systemPrompt: string;
}

// After
interface AgentRole {
  modules: {
    identity: string;
    workflow?: string;
  };
}
```

## 4. Tool Section Auto-Generation

```typescript
function buildToolsSection(executor: ToolExecutor): string {
  const descriptors = executor.getToolDescriptors();
  if (descriptors.length === 0) return '';
  const lines = descriptors.map((t) => `- ${t.name}: ${t.description}`);
  return `## Available Tools\n${lines.join('\n')}`;
}
```

Guarantees: prompt text = actual tool registration. No drift. If `createView()` filters to 5 tools, prompt lists exactly those 5.

## 5. Migration: Secretary Role Example

**Before** (125 lines, ~800 tokens):

```typescript
systemPrompt: [
  'You are the Secretary of Cabinet...',
  '',
  'You have access to file tools (read, write, edit, list, glob, grep), web tools (web_fetch), shell tools (execute_command), memory tools (remember, recall, search_memory), and project management tools.',
  // ... 100+ more lines including decision mode, routing rules, dev workflow, etc.
  'If you are unsure about system capabilities, data directories, or the responsibilities of other agents, use query_system_knowledge to look up the information.',
].join('\n')
```

**After** (~30 lines, ~200 tokens):

```typescript
modules: {
  identity: [
    'You are the Secretary of Cabinet — the entry point for all Captain interactions.',
    '',
    'Core responsibilities:',
    "1. Understand the Captain's intent. Handle general questions directly.",
    '2. For specialized tasks, route to the appropriate cabinet member.',
    '3. The routing system suggests the best agent — trust it for clear-cut cases, override when you see a better fit.',
  ].join('\n'),
  workflow: [
    '## Routing Rules',
    '- Route to meeting_chair: meeting organization with multiple perspectives.',
    '- Route to organize: workflow design, agent creation, skill writing, MCP building.',
    '- Handle yourself: general questions, code review, file review, analysis.',
    '',
    '## Decision Analysis Mode',
    'When asked for decision analysis (权衡/选择/决策), handle it yourself:',
    '1. Frame the real question. 2. Expand options. 3. Evaluate across cost, risk, time, reversibility.',
    '4. Assign L0-L3 level. 5. Use create_decision tool. 6. Recommend with caveats.',
    '',
    '## Development Workflow',
    'Edit code → Run tests → Read errors → Fix → Report summary when tests pass.',
    '',
    '## Session Start',
    '- Check short-term memory for a "session_brief". If present, present it as a context summary.',
    '',
    '## Routing Feedback',
    'Watch for user feedback signals after specialist responses:',
    '- Negative ("不对", "不是这个", "错了") → route was wrong, re-route.',
    '- Positive ("很好", "不错", "对的") → route was correct.',
    '',
    '## Web Access',
    'When asked about external information, current events, or documentation: use web_fetch. Do not guess or hallucinate external content.',
  ].join('\n'),
}
```

## 6. Call Site Changes

### 6.1 ContextBuilder

```typescript
// Before
systemPrompt = this.buildDefaultSystemPrompt(projectContext, preferences, rules, roleSystemPrompt);

// After
const effectivePrompt = roleSystemPrompt
  ?? assemblePrompt({
      modules: role.modules,
      toolExecutor: this.toolExecutor,       // NEW: ContextBuilder needs executor reference
      dynamicContext: `${projectContext}\nCaptain preferences: ${stableStringify(preferences)}`,
    });
```

ContextBuilder gains a `toolExecutor` field, injected via constructor:

```typescript
// Before
constructor(private readonly memory: MemoryProvider) {}

// After
constructor(
  private readonly memory: MemoryProvider,
  private readonly toolExecutor: ToolExecutor,
) {}
```

AgentLoop already holds `this.toolExecutor` — passes it to `new ContextBuilder(memoryProvider, toolExecutor)`.

### 6.2 createAgentNodeFactory

```typescript
// Before
const systemPrompt = override
  ? `${config.role.systemPrompt}\n\n${override}`
  : config.role.systemPrompt;

// After
let systemPrompt = assemblePrompt({
  modules: config.role.modules,
  toolExecutor: toolView;
});
if (override) {
  systemPrompt = `${systemPrompt}\n\n${override}`;
}
```

## 7. File Structure

```
packages/agent/src/prompt-shared.ts      ← NEW, ~20 lines
packages/agent/src/prompt-assembler.ts   ← NEW, ~50 lines
packages/agent/src/agent-roles.ts        ← MODIFY, 5 roles: systemPrompt → modules
packages/agent/src/context-builder.ts    ← MODIFY, add toolExecutor param, call assemblePrompt
packages/agent/src/agent-node.ts         ← MODIFY, call assemblePrompt
packages/agent/src/index.ts              ← MODIFY, export new symbols
```

No changes to `packages/graph/` or any other package.

## 8. Non-Goals

- **No template language** — no `{{variable}}` syntax. TypeScript string composition is the template engine.
- **No prompt versioning beyond git** — git history is the version control.
- **No hot-reload** — prompts are code. Changing them requires a rebuild, just like any other TypeScript change.
- **No few-shot management** — out of scope for this spec. Few-shot injection can be added later by extending `AssembleOptions`.
- **No prompt performance metrics** — we're not measuring "which prompt variant is better" in an automated way. That's evaluation framework territory.

## 9. Success Criteria

- `assemblePrompt()` produces correct prompts for all 5 built-in roles
- Tool section matches `toolExecutor.getToolDescriptors()` — verified by test
- All 78 existing agent tests pass + new prompt-assembler tests
- Shared rules not duplicated across roles
- TypeScript strict mode — no errors
