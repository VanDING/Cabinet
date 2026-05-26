# Convert WorkflowDesigner & AgentCreator to Built-in Skills

## 1. Goal

Remove `workflow_designer` and `agent_creator` from the AgentRole hierarchy and re-implement them as **built-in Cabinet skills** registered in `SkillRegistry`. Additionally, introduce two new built-in skills (`skillCreator`, `mcpBuilder`) adapted from Anthropic's official skill definitions.

All four skills are invoked by the `organize` agent rather than being standalone routed agents.

## 2. Scope

### In Scope
- Delete `WORKFLOW_DESIGNER_ROLE` and `AGENT_CREATOR_ROLE` from `agent-roles.ts`.
- Remove `workflow_designer` and `agent_creator` from `AgentRoleType`.
- Create `packages/agent/src/built-in-skills.ts` with 4 hard-coded `SkillEntry` definitions.
- Register built-in skills during agent layer initialization.
- Update `secretary` intent parser: remove `workflow_request` and `agent_creator_request` intents; route work-flow/agent-creation to `organize_request`.
- Add `skill_request` and `mcp_request` intents, also routed to `organize`.
- Update `secretary-agent.ts` fallback routing list.
- Update `system-knowledge-base.ts` agent boundary docs.
- Light-weight adaptation of `skill-creator` and `mcp-builder` (core prompt only, no local scripts/references).

### Out of Scope
- Modifying the `SkillRegistry` API.
- Changing how skills are executed (still via `use_skill__*` tools).
- Introducing full Anthropic `scripts/`, `agents/`, or `references/` directories.
- UI changes for skill discovery.

## 3. Architecture

```
User request
    |
    v
Secretary Intent Parser
    |
    +-- "帮我设计工作流" --------------> organize_request
    +-- "创建一个 agent" --------------> organize_request
    +-- "写一个 skill" ----------------> skill_request
    +-- "搭一个 MCP server" -----------> mcp_request
    |
    v
Organize Agent Loop
    |
    +-- LLM sees use_skill__workflowDesigner
    +-- LLM sees use_skill__agentCreator
    +-- LLM sees use_skill__skillCreator
    +-- LLM sees use_skill__mcpBuilder
    |
    v
SkillRegistry.executeSkill()  ->  promptTemplate  ->  Organize continues with tools
```

## 4. Skill Definitions

### 4.1 workflowDesigner

**Metadata**
- `name`: `workflowDesigner`
- `description`: `Design and modify Cabinet workflows. Guides step-by-step workflow creation, agent assignment, and validation. Use when the user wants to create, edit, or review a multi-step automated process.`
- `kind`: `prompt`
- `version`: `1`
- `status`: `active`

**PromptTemplate**
```markdown
## Workflow Designer Skill

You are using the Workflow Designer skill. Help the user design and modify Cabinet workflows — multi-step automated processes.

### Quick Reference
- **Step types**: aiAgent | humanApproval | condition | parallel | notification | wait | llmCall
- **Connections**: Steps connect via `input.from`: `"trigger"` (first step) or another step id.
- **Segments**: Consecutive steps with the same agent share context as a "segment".
- **Conditions**: Expression syntax supports `{{steps.X.output}}`, comparisons, AND/OR/NOT.
- **Parallel**: Specify `children[]` and aggregation (`all` | `first` | `merge`).
- **Human approval**: Set `retryTarget` and actions (`continue` | `retry` | `halt`).
- **Capabilities**: Must be declared per step — files.read/write, web.fetch/http, shell, knowledge.search, evaluation.

For the full WorkflowDefinition JSON schema, request the on-demand rule "workflow-schema".

### Creation Process
1. Understand the goal. Ask clarifying questions if steps are ambiguous.
2. Use `list_agents` to see available roles. Consecutive steps with same agent = shared context segment.
3. Design step-by-step. If the workflow needs file/web/shell access, ASK the user first.
4. Generate the WorkflowDefinition JSON and present for review.
5. After confirmation, call `create_workflow` to save.

### Modification Process
1. Use `list_workflows` → `get_workflow` to read the target.
2. Only modify affected steps. Show before/after diff.
3. Call `update_workflow` after confirmation.

### Agent Assignment
- Same agent for consecutive steps = shared context (efficient).
- Different agent only when: different model, expertise domain, or service boundary.
- Default: `"secretary"` if no specialized agent fits.
- Every `aiAgent` step MUST have an `agent` field.

### Guidelines
- Keep workflows to 4-8 steps. Split larger processes into sub-workflows.
- Add `humanApproval` before destructive or high-cost actions.
- Use fast model for routine steps, reasoning model for complex analysis.
- Check for similar workflows with `list_workflows` before creating duplicates.
- Present the plan in plain language first, then show the JSON.
```

### 4.2 agentCreator

**Metadata**
- `name`: `agentCreator`
- `description`: `Create, modify, and delete custom Cabinet AI agents. Guides the user through defining a role, system prompt, model, and tool permissions. Use when the user wants to create or manage a custom agent.`
- `kind`: `prompt`
- `version`: `1`
- `status`: `active`

**PromptTemplate**
```markdown
## Agent Creator Skill

You are using the Agent Creator skill. Help the user create, modify, and delete custom AI agents.

### Creation Process

**Step 1: Understand intent**
Understand what the user needs. Ask clarifying questions if the purpose is vague.

**Step 2: Basic configuration**
Define the core properties:
- **Name**: short, descriptive (e.g., "Market Analyst", "Code Reviewer"). 2-64 chars, letters/digits/Chinese/underscores/hyphens/spaces.
- **Description**: one sentence explaining what it does.
- **System prompt**: detailed instructions for the agent. Include its role, rules, and output format. 3-5 paragraphs max.
- **Model**: recommend the fast model for lightweight tasks, the reasoning model for complex ones.
- **Tools**: which cabinet tools should it have access to? Start with the essentials, not everything.
  - Note: skill tools appear as `use_skill__{skillName}` in the tool list. If this agent needs to invoke a skill, include the corresponding `use_skill__xxx` entry.

**Step 3: Advanced configuration (optional)**
Ask the user: "Do you want to adjust any advanced settings? (say 'default' to skip)"
- **temperature** (default 0.3): lower = more deterministic, higher = more creative.
- **maxResponseTokens** (default 4000): maximum response length.
- **contextBudget** (default 0.3): fraction of context window reserved for this agent.
If the user says "default" or is unsure, skip this step and use the defaults.

**Step 4: Validate and create**
1. Use `list_agents` to check for duplicates before creating.
2. Use `register_agent` to save the new agent.
3. After creation, tell the user the agent is ready. The Secretary will automatically route to it by name.

### Modification Process
1. Use `list_agents` to show all available agents (built-in and custom).
2. Ask the user which agent to modify and what to change.
3. Show the current configuration before asking what to update.
4. Use `update_agent` to apply changes.
5. Confirm the changes to the user.

### Deletion Process
1. Use `list_agents` to show all custom agents.
2. Ask the user which agent to delete. Only custom agents can be deleted.
3. **Warn the user this is irreversible** — the agent cannot be recovered.
4. Ask for explicit confirmation before proceeding.
5. Use `delete_agent` to remove the agent.

### Guidelines
- Keep system prompts focused and actionable. 3-5 paragraphs max.
- Default to fast model unless the task genuinely needs reasoning-level capability.
- Restrict tools to what the agent actually needs. An agent that only analyzes does not need write tools.
- If the user is unsure about details, make reasonable suggestions and ask for confirmation.
- Never delete built-in agents (secretary, decision_analyst, meeting_chair, reviewer, curator, organize).
```

### 4.3 skillCreator

**Metadata**
- `name`: `skillCreator`
- `description`: `Create new Cabinet skills, modify and improve existing skills. Use when users want to create a skill from scratch, edit or optimize an existing skill, or write a SKILL.md file.`
- `kind`: `prompt`
- `version`: `1`
- `status`: `active`

**PromptTemplate**
```markdown
## Skill Creator

You are using the Skill Creator skill. Help the user create new skills and iteratively improve them.

At a high level, the process goes like this:
- Decide what the skill should do and roughly how it should do it.
- Write a draft of the skill.
- Create a few test prompts and run them.
- Evaluate the results with the user, both qualitatively and quantitatively.
- Rewrite the skill based on feedback.
- Repeat until satisfied.

Your job is to figure out where the user is in this process and help them progress through the stages.

### Communicating with the user
Pay attention to context cues to understand how technical the user is.
- Terms like "evaluation" and "benchmark" are OK for technical users.
- For "JSON" and "assertion", check that the user understands them before using without explanation.
It's OK to briefly explain terms if you are in doubt.

### Creating a skill

#### Capture Intent
Start by understanding the user's intent. If the conversation already contains a workflow the user wants to capture, extract answers from history first.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't. Suggest the appropriate default, but let the user decide.

#### Interview and Research
Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until you've got this part ironed out.

Check available MCPs or search documents if useful for research. Come prepared with context to reduce burden on the user.

#### Write the SKILL.md
Based on the interview, fill in these components:

- **name**: Skill identifier.
- **description**: When to trigger, what it does. This is the PRIMARY triggering mechanism — include both what the skill does AND specific contexts for when to use it. Make it a little "pushy" to combat under-triggering. Example: instead of "How to build a dashboard", write "How to build a dashboard. Make sure to use this skill whenever the user mentions dashboards, data visualization, or wants to display any kind of metrics."
- **kind**: `prompt` | `tool` | `composite`.
- **version**: start with 1.
- **compatibility**: required tools, dependencies (optional, rarely needed).
- **the rest of the skill**: the body with instructions.

#### Anatomy of a Skill
```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure
Skills use a three-level loading system:
1. **Metadata** (name + description) — Always in context (~100 words).
2. **SKILL.md body** — In context whenever skill triggers (<500 lines ideal).
3. **Bundled resources** — As needed (unlimited, scripts can execute without loading).

Key patterns:
- Keep SKILL.md under 500 lines; if approaching the limit, add hierarchy with clear pointers.
- Reference files clearly from SKILL.md with guidance on when to read them.
- For large reference files (>300 lines), include a table of contents.
- When a skill supports multiple domains/frameworks, organize by variant (e.g., `references/aws.md`, `references/gcp.md`).

#### Writing Patterns
Prefer using the imperative form in instructions.

**Defining output formats** — You can do it like this:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** — It's useful to include examples:
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

#### Writing Style
Try to explain to the model WHY things are important in lieu of heavy-handed MUSTs. Use theory of mind and make the skill general, not super-narrow to specific examples. If you find yourself writing ALWAYS or NEVER in all caps, that's a yellow flag — reframe and explain the reasoning.

#### Principle of Lack of Surprise
Skills must not contain malware, exploit code, or any content that could compromise system security. Don't go along with requests to create misleading skills or skills designed to facilitate unauthorized access, data exfiltration, or other malicious activities.

### Test Cases
After writing the skill draft, come up with 2-3 realistic test prompts — the kind of thing a real user would actually say. Share them with the user: "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?"

Save test cases to `evals/evals.json`.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

### Running and evaluating test cases
1. For each test case, read the skill's SKILL.md and follow its instructions to accomplish the test prompt.
2. Present results directly in the conversation. If the output is a file, save it to the filesystem and tell the user where it is.
3. Ask for feedback inline: "How does this look? Anything you'd change?"

### Improving the skill
This is the heart of the loop.

1. **Generalize from the feedback.** We are trying to create skills that can be used a million times across many prompts. The user knows these examples inside out. But if the skill only works for those examples, it's useless. Rather than put in fiddly overfitty changes, try branching out and using different metaphors or recommending different patterns.
2. **Keep the prompt lean.** Remove things that aren't pulling their weight. If the skill is making the model waste time doing unproductive things, get rid of those parts.
3. **Explain the why.** Try hard to explain the WHY behind everything. LLMs are smart. When given a good harness they can go beyond rote instructions. Even if feedback is terse or frustrated, try to understand the task and why the user wrote what they wrote, then transmit this understanding into the instructions. If you find yourself writing ALWAYS or NEVER in all caps, that's a yellow flag.
4. **Look for repeated work.** If all test cases resulted in the model writing similar helper scripts or taking the same multi-step approach, that's a strong signal the skill should bundle that script. Write it once, put it in `scripts/`, and tell the skill to use it.

### The iteration loop
After improving the skill:
1. Apply improvements.
2. Rerun all test cases.
3. Ask for feedback.
4. Read feedback, improve again, repeat.

Keep going until:
- The user says they're happy.
- The feedback is all empty (everything looks good).
- You're not making meaningful progress.

### Description Optimization
After creating or improving a skill, offer to optimize the description for better triggering accuracy.

1. Draft 10-20 realistic trigger eval queries — a mix of should-trigger and should-not-trigger. Focus on edge cases and near-misses.
2. Review them with the user.
3. Manually iterate on the description field, testing against the eval queries.
4. Report before/after and the scores.

### Updating an existing skill
The user might ask you to update an existing skill, not create a new one. In that case:
- **Preserve the original name.** Use the directory name and `name` frontmatter field unchanged.
- **Copy to a writable location before editing.** The installed skill path may be read-only. Copy to a working directory, edit there, and save from the copy.
```

### 4.4 mcpBuilder

**Metadata**
- `name`: `mcpBuilder`
- `description`: `Guide for creating high-quality MCP (Model Context Protocol) servers. Use when building MCP servers to integrate external APIs or services, in Python or TypeScript.`
- `kind`: `prompt`
- `version`: `1`
- `status`: `active`

**PromptTemplate**
```markdown
## MCP Server Development Guide

You are using the MCP Builder skill. Guide the user through creating high-quality MCP (Model Context Protocol) servers.

The quality of an MCP server is measured by how well it enables LLMs to accomplish real-world tasks.

---

# Process

## Phase 1: Deep Research and Planning

### 1.1 Understand Modern MCP Design

**API Coverage vs. Workflow Tools:**
Balance comprehensive API endpoint coverage with specialized workflow tools. When uncertain, prioritize comprehensive API coverage.

**Tool Naming and Discoverability:**
Use clear, descriptive tool names with consistent prefixes (e.g., `github_create_issue`, `github_list_repos`) and action-oriented naming.

**Context Management:**
Agents benefit from concise tool descriptions and the ability to filter/paginate results. Design tools that return focused, relevant data.

**Actionable Error Messages:**
Error messages should guide agents toward solutions with specific suggestions and next steps.

### 1.2 Study MCP Protocol Documentation

Navigate the MCP specification: start with the sitemap `https://modelcontextprotocol.io/sitemap.xml`, then fetch specific pages with `.md` suffix.

Key pages to review:
- Specification overview and architecture
- Transport mechanisms (streamable HTTP, stdio)
- Tool, resource, and prompt definitions

### 1.3 Study Framework Documentation

**Recommended stack:**
- **Language**: TypeScript (high-quality SDK, good compatibility, excellent AI code generation)
- **Transport**: Streamable HTTP for remote servers (stateless JSON, simpler to scale). stdio for local servers.

Load framework documentation via WebFetch:
- **TypeScript SDK**: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- **Python SDK**: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`

### 1.4 Plan Your Implementation

**Understand the API:**
Review the service's API documentation. Identify key endpoints, authentication requirements, and data models.

**Tool Selection:**
Prioritize comprehensive API coverage. List endpoints to implement, starting with the most common operations.

---

## Phase 2: Implementation

### 2.1 Set Up Project Structure

**TypeScript:**
- Initialize with `npm init -y`
- Install: `@modelcontextprotocol/sdk`, `zod`, `typescript`
- Create `tsconfig.json` with strict mode
- Entry point: `src/index.ts`

**Python:**
- Install: `mcp`, `pydantic`
- Entry point: `server.py`

### 2.2 Implement Core Infrastructure

Create shared utilities:
- API client with authentication
- Error handling helpers
- Response formatting (JSON/Markdown)
- Pagination support

### 2.3 Implement Tools

For each tool:

**Input Schema:**
- Use Zod (TypeScript) or Pydantic (Python)
- Include constraints and clear descriptions
- Add examples in field descriptions

**Output Schema:**
- Define `outputSchema` where possible for structured data
- Use `structuredContent` in tool responses (TypeScript SDK feature)

**Tool Description:**
- Concise summary of functionality
- Parameter descriptions
- Return type schema

**Implementation:**
- Async/await for I/O operations
- Proper error handling with actionable messages
- Support pagination where applicable
- Return both text content and structured data when using modern SDKs

**Annotations:**
- `readOnlyHint`: true/false
- `destructiveHint`: true/false
- `idempotentHint`: true/false
- `openWorldHint`: true/false

---

## Phase 3: Review and Test

### 3.1 Code Quality

Review for:
- No duplicated code (DRY principle)
- Consistent error handling
- Full type coverage
- Clear tool descriptions

### 3.2 Build and Test

**TypeScript:**
- Run `npm run build` to verify compilation
- Test with MCP Inspector: `npx @modelcontextprotocol/inspector`

**Python:**
- Verify syntax: `python -m py_compile your_server.py`
- Test with MCP Inspector

---

## Phase 4: Create Evaluations

After implementing your MCP server, create comprehensive evaluations to test its effectiveness.

### 4.1 Understand Evaluation Purpose

Use evaluations to test whether LLMs can effectively use your MCP server to answer realistic, complex questions.

### 4.2 Create 10 Evaluation Questions

1. **Tool Inspection**: List available tools and understand their capabilities.
2. **Content Exploration**: Use READ-ONLY operations to explore available data.
3. **Question Generation**: Create 10 complex, realistic questions.
4. **Answer Verification**: Solve each question yourself to verify answers.

### 4.3 Evaluation Requirements

Ensure each question is:
- **Independent**: Not dependent on other questions
- **Read-only**: Only non-destructive operations required
- **Complex**: Requiring multiple tool calls and deep exploration
- **Realistic**: Based on real use cases humans would care about
- **Verifiable**: Single, clear answer that can be verified by string comparison
- **Stable**: Answer won't change over time

### 4.4 Output Format

Create an XML file with this structure:
```xml
<evaluation>
  <qa_pair>
    <question>Find discussions about AI model launches with animal codenames...</question>
    <answer>3</answer>
  </qa_pair>
</evaluation>
```
```

## 5. File Changes

| File | Change |
|------|--------|
| `packages/agent/src/agent-roles.ts` | Remove `WORKFLOW_DESIGNER_ROLE`, `AGENT_CREATOR_ROLE`, `'workflow_designer'`, `'agent_creator'` from `AgentRoleType`, and related registry registrations. |
| `packages/agent/src/built-in-skills.ts` | **New file.** Export 4 `SkillEntry` constants: `WORKFLOW_DESIGNER_SKILL`, `AGENT_CREATOR_SKILL`, `SKILL_CREATOR_SKILL`, `MCP_BUILDER_SKILL`. |
| `packages/agent/src/index.ts` | Import the 4 built-in skills and register them in `getSkillRegistry()` during init. |
| `packages/secretary/src/intent-parser.ts` | Remove `workflow_request` and `agent_creator_request` from `ParsedIntent`. Remove detection logic. Remove from `validAgentTypes`. Remove from routing. Add `skill_request` and `mcp_request` intents with routing to `organize`. Update `availableAgentsDesc`. |
| `packages/secretary/src/secretary-agent.ts` | Update re-route candidate list (`workflow_designer` -> `organize`). |
| `packages/storage/src/system-knowledge-base.ts` | Update agent boundary docs: `workflow_designer` and `agent_creator` removed from agent list; their responsibilities now listed under `organize`. |

## 6. Routing Details

### Intent Parser Changes

```typescript
// BEFORE
| { kind: 'workflow_request'; topic: string; context: string; suggestedDimensions: string[] }
| { kind: 'agent_creator_request'; topic: string; context: string }

// AFTER
| { kind: 'skill_request'; topic: string; context: string }
| { kind: 'mcp_request'; topic: string; context: string }
```

Detection keywords:
- `skill_request`: "创建 skill" / "写 skill" / "skill" + "创建/写/优化" / "SKILL.md"
- `mcp_request`: "MCP" / "mcp server" / "model context protocol"

Both route to `organize` agent.

### Secretary Re-Routing

In `secretary-agent.ts` fallback routing, replace:
```
workflow_designer, agent_creator
```
with nothing — `organize` is already the catch-all for creation tasks.

## 7. Testing Strategy

1. **Unit tests for intent parser**: Verify that "设计一个工作流" now resolves to `organize_request` instead of `workflow_request`. Verify "创建一个 skill" resolves to `skill_request` -> `organize`.
2. **Skill registry test**: Verify `getSkillRegistry().listNames()` includes `workflowDesigner`, `agentCreator`, `skillCreator`, `mcpBuilder` after init.
3. **Agent role registry test**: Verify `listBuiltIn()` no longer returns the deleted roles.
4. **Integration smoke test**: Send a message "帮我设计一个审批工作流" through the secretary pipeline; confirm it routes to `organize` and `organize` sees `use_skill__workflowDesigner` in its tool list.

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `organize` agent's system prompt does not mention skills | Add a line in `ORGANIZE_ROLE.systemPrompt`: "When the user wants to design workflows, create agents, write skills, or build MCP servers, invoke the corresponding built-in skill via `use_skill__*` tools." |
| Anthropic skill prompts reference tools/scripts Cabinet lacks | Removed those sections in the light-weight adaptation (see §4.3 and §4.4). |
| Existing saved conversations or memory reference `workflow_designer` / `agent_creator` as agents | These are historical references; the skills serve the same functional purpose. No migration needed because the capabilities are preserved, just the invocation path changes. |
| Skill prompt length | `skillCreator` and `mcpBuilder` are long. They stay within ~6000 tokens after pruning scripts/refs. Acceptable for reasoning-tier tasks that `organize` already handles. |
