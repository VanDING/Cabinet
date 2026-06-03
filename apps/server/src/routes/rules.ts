import { Hono } from 'hono';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getServerContext } from '../context.js';
import { CABINET_DIR } from '@cabinet/storage';

export const rulesRouter = new Hono();

const RULES_DIR = join(CABINET_DIR, 'rules');

function ensureRulesDir() {
  if (!existsSync(RULES_DIR)) {
    mkdirSync(RULES_DIR, { recursive: true });
  }
}

function parseRuleFile(fullPath: string) {
  const raw = readFileSync(fullPath, 'utf-8');

  let description = '';
  let globs: string[] = [];
  let alwaysApply = false;
  let tags: string[] = [];

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  let body = raw;
  if (fmMatch) {
    body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const yaml = fmMatch[1]!;
    for (const line of yaml.split('\n')) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1]!;
      const val = kv[2]!.trim().replace(/^['"]|['"]$/g, '');
      switch (key) {
        case 'description':
          description = val;
          break;
        case 'alwaysApply':
          alwaysApply = val === 'true';
          break;
        case 'tags':
          tags = val
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          break;
        case 'globs':
          globs = val
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          break;
      }
    }
  }

  const mode =
    alwaysApply || (!globs.length && !description)
      ? 'always'
      : globs.length > 0
        ? 'auto'
        : 'on-demand';

  return { description, globs, alwaysApply, tags, body: body.trim(), mode };
}

function buildRuleFile(data: {
  mode: string;
  description?: string;
  globs?: string[];
  tags?: string[];
  content: string;
}): string {
  const lines: string[] = ['---'];

  if (data.description) {
    lines.push(`description: "${data.description}"`);
  }

  if (data.mode === 'always') {
    lines.push('alwaysApply: true');
  }

  if (data.globs && data.globs.length > 0) {
    lines.push(`globs: [${data.globs.map((g) => `"${g}"`).join(', ')}]`);
  }

  if (data.tags && data.tags.length > 0) {
    lines.push(`tags: [${data.tags.map((t) => `"${t}"`).join(', ')}]`);
  }

  lines.push('---');
  lines.push('');
  lines.push(data.content.trim());
  lines.push('');

  return lines.join('\n');
}

// GET /api/rules — list all rules with metadata and content
rulesRouter.get('/', (c) => {
  ensureRulesDir();
  const { logger } = getServerContext();

  try {
    const files = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md'));
    const rules = files.map((filename) => {
      const fullPath = join(RULES_DIR, filename);
      const parsed = parseRuleFile(fullPath);

      return {
        filename,
        path: relative(RULES_DIR, fullPath),
        description: parsed.description,
        globs: parsed.globs,
        alwaysApply: parsed.alwaysApply,
        tags: parsed.tags,
        content: parsed.body,
        mode: parsed.mode,
      };
    });

    return c.json({ rules, directory: RULES_DIR });
  } catch (e) {
    logger.error('Failed to list rules', { error: String(e) });
    return c.json({ rules: [], error: (e as Error).message });
  }
});

// POST /api/rules — create a new rule file
rulesRouter.post('/', async (c) => {
  ensureRulesDir();
  const body = await c.req.json();
  let filename = body.filename as string;

  if (!filename) return c.json({ error: 'filename required' }, 400);
  if (!filename.endsWith('.md')) filename += '.md';

  const fullPath = join(RULES_DIR, filename);
  if (existsSync(fullPath)) {
    return c.json({ error: 'file already exists' }, 409);
  }

  const fileContent = buildRuleFile({
    mode: body.mode || 'always',
    description: body.description,
    globs: body.globs || [],
    tags: body.tags || [],
    content: body.content || '',
  });

  writeFileSync(fullPath, fileContent, 'utf-8');
  return c.json({ filename, path: relative(process.cwd(), fullPath), saved: true });
});

// PUT /api/rules/:filename — update a rule file (full replace)
rulesRouter.put('/:filename', async (c) => {
  ensureRulesDir();
  const filename = c.req.param('filename');
  const body = await c.req.json();

  if (!filename.endsWith('.md')) return c.json({ error: 'filename must end with .md' }, 400);

  const fullPath = join(RULES_DIR, filename);

  const fileContent = buildRuleFile({
    mode: body.mode || 'always',
    description: body.description,
    globs: body.globs || [],
    tags: body.tags || [],
    content: body.content || '',
  });

  writeFileSync(fullPath, fileContent, 'utf-8');
  return c.json({ filename, path: relative(process.cwd(), fullPath), saved: true });
});

// DELETE /api/rules/:filename — delete a rule file
rulesRouter.delete('/:filename', (c) => {
  ensureRulesDir();
  const filename = c.req.param('filename');

  if (!filename.endsWith('.md')) return c.json({ error: 'filename must end with .md' }, 400);

  const fullPath = join(RULES_DIR, filename);
  if (!existsSync(fullPath)) {
    return c.json({ error: 'file not found' }, 404);
  }

  unlinkSync(fullPath);
  return c.json({ filename, deleted: true });
});
