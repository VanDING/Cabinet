import { Hono } from 'hono';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
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

// GET /api/rules — list all rules with metadata and content
rulesRouter.get('/', (c) => {
  ensureRulesDir();
  const { logger } = getServerContext();

  try {
    const files = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md'));
    const rules = files.map((filename) => {
      const fullPath = join(RULES_DIR, filename);
      const raw = readFileSync(fullPath, 'utf-8');

      // Parse frontmatter
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

      return {
        filename,
        path: relative(RULES_DIR, fullPath),
        description,
        globs,
        alwaysApply,
        tags,
        content: body.trim(),
        mode:
          alwaysApply || (!globs.length && !description)
            ? 'always'
            : globs.length > 0
              ? 'auto'
              : 'on-demand',
      };
    });

    return c.json({ rules, directory: RULES_DIR });
  } catch (e) {
    logger.error('Failed to list rules', { error: String(e) });
    return c.json({ rules: [], error: (e as Error).message });
  }
});

// PUT /api/rules/:filename — update a rule file
rulesRouter.put('/:filename', async (c) => {
  ensureRulesDir();
  const filename = c.req.param('filename');
  const body = await c.req.json();
  const content = body.content as string;

  if (!content) return c.json({ error: 'content required' }, 400);
  if (!filename.endsWith('.md')) return c.json({ error: 'filename must end with .md' }, 400);

  const fullPath = join(RULES_DIR, filename);
  writeFileSync(fullPath, content, 'utf-8');

  return c.json({ filename, path: relative(process.cwd(), fullPath), saved: true });
});
