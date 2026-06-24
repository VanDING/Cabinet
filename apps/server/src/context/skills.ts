import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { SkillRegistry, importSkillFromMarkdown, setSkillRegistry } from '@cabinet/agent';
import type { BuildState } from './build-state.js';

const BUILTIN_SKILLS: Array<{ name: string; description: string; body: string }> = [
  {
    name: 'skillCreator',
    description: 'Guide for creating, modifying, and improving Cabinet skills',
    body: `## Skill Creator

You are a skill creation specialist. When invoked, follow this process:

### 1. Discovery
- Ask the Captain what the skill should accomplish
- Determine the skill type: \`tool\` (callable), \`prompt\` (injected into context), or \`composite\` (both)
- Identify required inputs and expected outputs

### 2. Design
- Draft the SKILL.md content with clear YAML frontmatter (name, description, kind, exposure)
- Write concise but thorough Markdown instructions
- Include usage examples and edge cases

### 3. Creation
- Use \`create_skill\` tool with:
  - \`name\`: skill identifier (camelCase, no spaces)
  - \`description\`: one-line summary of what it does
  - \`promptTemplate\`: the full Markdown instruction body
  - \`kind\`: tool | prompt | composite
  - \`exposure\`: prompt | tool | both (default: both)

### 4. Verification
- After creation, invoke the skill via \`use_skill\` to verify it loads correctly
- Check the SKILL.md was written to \`~/.cabinet/skills/<name>/SKILL.md\`

### Rules
- Skill names must be camelCase (e.g. \`codeReview\`, \`gitHelper\`)
- Descriptions should be actionable: "Guides the user through X" or "Automates Y process"
- Prompts should be self-contained — assume the agent has standard tools (filesystem, web, git)
- For \`tool\` type skills, prefer exposure \`both\` so they appear as callable tools AND in the system context`,
  },
  {
    name: 'agentCreator',
    description: 'Guide for creating and configuring custom AI agents in Cabinet',
    body: `## Agent Creator

You help the Captain design and register custom AI agents within Cabinet. Follow this process:

### 1. Requirements
- Ask what role the agent should play (e.g. "security auditor", "documentation writer")
- Determine the tools the agent needs access to
- Define the agent's personality, constraints, and decision-making framework

### 2. Configuration
- Use \`register_external_agent\` (or equivalent) to create the agent
- Define:
  - \`name\`: agent identifier
  - \`role\`: system prompt describing the agent's purpose and behavior
  - \`allowedTools\`: list of tool names the agent can use
  - \`delegationTier\`: autonomous | supervised | readonly

### 3. Testing
- After creation, send a test message to verify the agent responds correctly
- Check the agent appears in the agent list

### Agent Design Principles
- Each agent should have a single clear responsibility (Single Responsibility Principle)
- Prefer autonomous agents for routine tasks, supervised for high-risk operations
- Document the agent's role clearly in its system prompt
- Use delegation tiers to control agent authority levels`,
  },
  {
    name: 'workflowDesigner',
    description: 'Guide for designing, building, and modifying Cabinet workflows',
    body: `## Workflow Designer

You help the Captain design automated workflows in Cabinet. A workflow is a sequence of steps (nodes) connected by edges that automate complex multi-step tasks.

### Workflow Concepts
- **Nodes**: Individual processing units (LLM calls, tool executions, decisions, delays)
- **Edges**: Connections between nodes defining execution order
- **Triggers**: Events that start a workflow (manual, scheduled, webhook)

### Design Process
1. **Clarify the goal**: What should the workflow accomplish end-to-end?
2. **Break down steps**: Decompose into discrete tasks
3. **Identify dependencies**: Which steps must happen before/after others?
4. **Design nodes**: Map each step to a node type (LLM, tool, condition, etc.)
5. **Configure**: Set input/output schemas, error handling, timeouts

### Best Practices
- Keep workflows focused — one workflow per business process
- Add error handling nodes at critical steps
- Include logging/monitoring nodes for observability
- Test with small inputs before scaling
- Document the workflow purpose and expected inputs/outputs`,
  },
  {
    name: 'mcpBuilder',
    description: 'Guide for developing MCP (Model Context Protocol) servers for Cabinet',
    body: `## MCP Builder

You help the Captain build MCP (Model Context Protocol) servers that extend Cabinet's capabilities with external tools and data sources.

### What is MCP?
MCP is a protocol that allows AI agents to connect with external services. An MCP server exposes tools, resources, and prompts that agents can use.

### Building an MCP Server
1. **Define the capability**: What should the server provide? (database access, API wrapper, file operations)
2. **Choose the transport**: stdio (local) or HTTP/SSE (remote)
3. **Implement tools**: Each tool has a name, description, input schema, and handler
4. **Test locally**: Run the server and verify tools respond correctly
5. **Register in Cabinet**: Configure the MCP server in Cabinet settings

### Tool Design Guidelines
- Each tool should have a clear, descriptive name
- Input schemas should validate all required parameters
- Error messages should be user-friendly and actionable
- Handle timeouts gracefully — external services can be slow
- Log tool invocations for debugging

### Registering in Cabinet
Once built, the MCP server can be registered via Cabinet settings or the MCP management UI, making its tools available to all agents.`,
  },
];

function ensureBuiltinSkills(
  dataDir: string,
  skillRegistry: SkillRegistry,
  skillRepo: import('@cabinet/storage').SkillRepository,
): void {
  const skillsDir = join(dataDir, 'skills');
  const existingNames = new Set(skillRegistry.listNames());

  for (const skill of BUILTIN_SKILLS) {
    if (existingNames.has(skill.name)) continue;

    const dir = join(skillsDir, skill.name);
    try {
      mkdirSync(dir, { recursive: true });
      const content = [
        '---',
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        'kind: tool',
        'exposure: both',
        'version: 1',
        'status: active',
        'builtIn: true',
        '---',
        '',
        skill.body,
      ].join('\n');
      writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');

      const id = `builtin_skill_${skill.name}_${Date.now()}`;
      skillRegistry.register({
        id,
        name: skill.name,
        description: skill.description,
        kind: 'tool',
        exposure: 'both',
        promptTemplate: skill.body,
        inputSchema: {},
        outputSchema: {},
        version: 1,
        status: 'active',
      });

      const existing = skillRepo.findByName(skill.name);
      if (!existing) {
        try {
          skillRepo.insert({
            id,
            name: skill.name,
            description: skill.description,
            kind: 'tool',
            input_schema: '{}',
            output_schema: '{}',
            prompt_template: skill.body,
            version: 1,
            status: 'active',
            metadata: JSON.stringify({ builtIn: true }),
            references_path: null,
            scripts_path: null,
          } as Parameters<typeof skillRepo.insert>[0]);
        } catch {
          /* DB insert is best-effort at startup */
        }
      }
    } catch {
      /* skip on error */
    }
  }
}

export function initSkills(state: BuildState): void {
  const { db, skillRepo, agentRegistry, agentRoleRepo } = state;
  if (!db || !skillRepo || !agentRegistry || !agentRoleRepo) {
    throw new Error('Missing required state for skills');
  }

  const skillRegistry = new SkillRegistry();
  setSkillRegistry(skillRegistry);
  try {
    const skillRows = skillRepo.findActive();
    for (const row of skillRows) {
      skillRegistry.register({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind as 'tool' | 'prompt' | 'composite',
        exposure: (row.exposure as 'prompt' | 'tool' | 'both') ?? 'prompt',
        promptTemplate: row.prompt_template,
        inputSchema: JSON.parse(row.input_schema ?? '{}'),
        outputSchema: JSON.parse(row.output_schema ?? '{}'),
        version: row.version,
        status: row.status as 'active' | 'draft' | 'deprecated',
      });
    }
    state.logger?.info('Skill registry loaded', { count: skillRows.length });
  } catch (e) {
    state.logger?.warn('Failed to load skills from DB', { error: String(e) });
  }

  // Ensure built-in skills exist in registry + filesystem on first startup
  try {
    ensureBuiltinSkills(state.dataDir, skillRegistry, skillRepo);
  } catch {
    /* best-effort */
  }

  state.skillRegistry = skillRegistry;
}

export function injectAgentSkillTools(mastra: unknown, skillRegistry: SkillRegistry): void {
  const agent = (mastra as any)?.getAgent?.('secretary');
  if (!agent) return;
  const skillTools = skillRegistry.getToolDefinitions();
  const skillToolMap: Record<string, unknown> = {};
  for (const tool of skillTools) {
    skillToolMap[tool.name] = tool;
  }
  if (Object.keys(skillToolMap).length > 0) {
    agent.__setTools(skillToolMap);
  }
}

export function scanSkillDirectory(state: BuildState): void {
  const { dataDir, skillRegistry, skillRepo, agentRegistry, agentRoleRepo } = state;
  if (!dataDir || !skillRegistry || !skillRepo || !agentRegistry || !agentRoleRepo) return;

  const skillsDir = join(dataDir, 'skills');
  try {
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    );
    for (const entry of skillDirs) {
      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      try {
        const content = readFileSync(skillPath, 'utf-8');
        const refsDir = join(skillsDir, entry.name, 'references');
        const scriptsDir = join(skillsDir, entry.name, 'scripts');
        const result = importSkillFromMarkdown(content, skillRegistry, {
          referencesPath: existsSync(refsDir) ? refsDir : undefined,
          scriptsPath: existsSync(scriptsDir) ? scriptsDir : undefined,
        });
        if (result) {
          const existing = skillRepo.findByName(result.name);
          if (!existing) {
            const skill = skillRegistry.load(result.name);
            if (skill) {
              skillRepo.insert({
                id: skill.id,
                name: skill.name,
                description: skill.description,
                kind: skill.kind,
                input_schema: '{}',
                output_schema: '{}',
                prompt_template: skill.promptTemplate,
                version: 1,
                status: 'active',
                metadata: null,
                references_path: skill.referencesPath ?? null,
                scripts_path: skill.scriptsPath ?? null,
                exposure: skill.exposure,
              });
            }
          }
        }
      } catch {
        /* skip malformed skill */
      }
    }
    state.logger?.info('Skills scanned from directory', { dir: skillsDir });
  } catch {
    /* skills dir empty */
  }
}
