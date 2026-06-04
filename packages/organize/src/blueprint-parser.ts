import type { Blueprint } from '@cabinet/types';

export class BlueprintParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlueprintParseError';
  }
}

/** Detect and compile EL expressions embedded in blueprint text. */
function tryCompileEL(text: string): { workflowEl?: string } {
  // Match ```el blocks or standalone THEN/WHEN expressions
  const elBlock = text.match(/```el\s*([\s\S]*?)```/);
  if (elBlock) return { workflowEl: elBlock[1]!.trim() };

  const elLine = text.match(/^el:\s*\|?\s*\n?\s*(THEN|WHEN|IF|SWITCH|FOR|WHILE|SUBFLOW)\(/m);
  if (elLine) {
    const rest = text.slice(text.indexOf(elLine[0]) + elLine[0].length);
    return { workflowEl: (elLine[0].replace(/^el:\s*\|?\s*\n?\s*/, '') + rest.split('\n')[0]).trim() };
  }

  return {};
}

export function parseBlueprint(text: string): Blueprint {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenceMatch) {
    for (const block of fenceMatch) {
      const inner = block.replace(/```(?:json)?\s*|```/g, '').trim();
      try {
        const parsed = JSON.parse(inner);
        if (isBlueprintShape(parsed)) return normalizeBlueprint(parsed);
      } catch {
        /* continue to next block */
      }
    }
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (isBlueprintShape(parsed)) return normalizeBlueprint(parsed);
    } catch {
      /* fall through */
    }
  }

  throw new BlueprintParseError(
    'Could not extract a valid Blueprint from the provided text. ' +
      'Ensure the output contains a JSON object with meta, agents, workflow, harness, or authorization fields.',
  );
}

export async function parseBlueprintWithLLM(
  text: string,
  gateway: {
    generateText: (opts: {
      model: string;
      messages: { role: 'user'; content: string }[];
      maxTokens: number;
      temperature: number;
    }) => Promise<{ content: string }>;
  },
): Promise<Blueprint> {
  const prompt = `Extract an organization blueprint from the following text.
Return ONLY a valid JSON object with this structure:
{
  "meta": { "goal": "..." },
  "agents": [{ "action": "use_existing|create_new", "name": "...", "prompt": "..." }],
  "workflow": { "steps": [{ "id": "...", "type": "...", "agent": "...", "input": { "from": "..." }, "condition": { "trueBranch": "...", "falseBranch": "..." }, "children": ["..."] }] },
  "harness": { "gates": [{ "node_id": "...", "criteria": "...", "evaluator": "..." }] },
  "authorization": { "rules": [{ "node_id": "...", "level": "L0|L1|L2|L3", "description": "..." }] }
}

Text to extract from:
${text.slice(0, 8000)}`;

  const response = await gateway.generateText({
    model: 'claude-haiku-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 3000,
    temperature: 0.1,
  });

  return parseBlueprint(response.content);
}

// ── Private helpers ──────────────────────────────

function isBlueprintShape(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  return 'meta' in o || 'workflow' in o || 'agents' in o;
}

function normalizeBlueprint(raw: Record<string, unknown>): Blueprint {
  return {
    meta: (raw.meta as Blueprint['meta']) ?? {},
    agents: (raw.agents as Blueprint['agents']) ?? [],
    workflow: (raw.workflow as Blueprint['workflow']) ?? { steps: [] },
    harness: (raw.harness as Blueprint['harness']) ?? { gates: [] },
    authorization: (raw.authorization as Blueprint['authorization']) ?? { rules: [] },
  };
}
