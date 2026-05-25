//
// Rules Loader — hierarchical, on-demand rule loading.
//
// Reads `.cabinet/rules/` directory (and project-level AGENTS.md/CABINET.md).
// Inspired by:
//   - Cursor's .mdc rules (globs + alwaysApply + description-based activation)
//   - Claude Code's .claude/rules/ directory
//   - OpenAI's AGENTS.md as directory index pattern
//
// Rules are Markdown files with optional YAML frontmatter.
// Example frontmatter: description, globs (array), alwaysApply (boolean), tags (array).
// Activation modes:
//   `alwaysApply: true` → loaded every session
//   `globs` defined → loaded when a matching file is in context
//   `description` only → summary shown to agent; loaded on request
//   no frontmatter → treated as alwaysApply
//
// Activation modes (inferred from frontmatter, no explicit type field):
//   - alwaysApply: true            → loaded every session
//   - globs defined, !alwaysApply  → loaded when a matching file is in context
//   - description only             → description read by agent; loaded on request
//   - no frontmatter               → treated as alwaysApply

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────

export interface RuleFrontmatter {
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
  /** Human-readable tags for agent-driven filtering */
  tags?: string[];
}

export interface LoadedRule {
  /** File path (relative to rules directory) */
  path: string;
  /** Rule content (markdown body, frontmatter stripped) */
  content: string;
  /** Parsed frontmatter */
  frontmatter: RuleFrontmatter;
  /** Content hash for cache invalidation */
  hash: string;
  /** Activation mode */
  mode: 'always' | 'auto' | 'on-demand';
}

export interface RulesContext {
  /** Files currently being worked on (for glob matching) */
  activeFiles: string[];
  /** Current task description (for semantic matching) */
  taskDescription?: string;
  /** Rule paths explicitly requested by the agent */
  requestedRules?: string[];
}

// ── Glob matching (minimal, no dependency) ─────────────────────

function globMatch(pattern: string, filepath: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars
    .replace(/\*\*\/?/g, '___DOUBLESTAR___') // placeholder for **
    .replace(/\*/g, '[^/]*') // * → anything except /
    .replace(/___DOUBLESTAR___/g, '.*') // ** → anything including /
    .replace(/\?/g, '.'); // ? → single char
  return new RegExp(`^${regexStr}$`).test(filepath);
}

// ── Rules Loader ───────────────────────────────────────────────

export class RulesLoader {
  private cache: Map<string, LoadedRule[]> = new Map();
  private fileTimestamps: Map<string, number> = new Map();
  private globalFileTimestamp = 0;

  constructor(
    private readonly rulesDirs: string[],
    private readonly globalFile?: string,
  ) {}

  /** Create a loader scanning the default locations. */
  static default(): RulesLoader {
    const dirs: string[] = [];
    const cwd = process.cwd();

    // Project-level .cabinet/rules/
    const projectRules = join(cwd, '.cabinet', 'rules');
    if (existsSync(projectRules)) dirs.push(projectRules);

    // Global .cabinet/rules/
    const homeRules = join(homedir(), '.cabinet', 'rules');
    if (existsSync(homeRules)) dirs.push(homeRules);

    const globalFile = join(homedir(), '.cabinet', 'CABINET.md');
    return new RulesLoader(dirs, existsSync(globalFile) ? globalFile : undefined);
  }

  /** Create a loader for a specific project (used when Cabinet manages agents for a project). */
  static forProject(projectRoot: string): RulesLoader {
    const dirs: string[] = [];
    const cabinetRules = join(projectRoot, '.cabinet', 'rules');
    if (existsSync(cabinetRules)) dirs.push(cabinetRules);

    // Global .cabinet/rules/
    const homeRules = join(homedir(), '.cabinet', 'rules');
    if (existsSync(homeRules)) dirs.push(homeRules);

    const globalFile = join(homedir(), '.cabinet', 'CABINET.md');
    return new RulesLoader(dirs, existsSync(globalFile) ? globalFile : undefined);
  }

  /** Load all rules, optionally filtered by context. */
  loadAll(ctx?: RulesContext): LoadedRule[] {
    const allRules: LoadedRule[] = [];

    // Global file rules are loaded first (highest precedence: constitution)
    if (this.globalFile) {
      const globalRule = this.loadGlobalFile();
      if (globalRule) allRules.push(globalRule);
    }

    for (const dir of this.rulesDirs) {
      const dirRules = this.loadDirectory(dir);
      allRules.push(...dirRules);
    }

    return this.filterByContext(allRules, ctx);
  }

  /** Load rules that should always be applied. */
  loadAlways(): LoadedRule[] {
    return this.loadAll().filter((r) => r.mode === 'always');
  }

  /** Load rules matching the given context. */
  loadMatching(ctx: RulesContext): LoadedRule[] {
    return this.loadAll(ctx);
  }

  /** Get a summary of available rules (for the agent to know what's available). */
  summarize(): string {
    const all = this.loadAll();
    if (all.length === 0) return 'No .cabinet/rules/ found.';

    const lines: string[] = ['## Available Rules', ''];
    for (const rule of all) {
      const desc = rule.frontmatter.description ?? basename(rule.path, '.md');
      const mode =
        rule.mode === 'always' ? '[always]' : rule.mode === 'auto' ? '[auto]' : '[on-demand]';
      lines.push(`- ${mode} ${desc} (${rule.path})`);
    }
    return lines.join('\n');
  }

  /** Reload rules (clears cache). */
  reload(): void {
    this.cache.clear();
    this.fileTimestamps.clear();
    this.globalFileTimestamp = 0;
  }

  // ── Private ────────────────────────────────────────────────

  private loadGlobalFile(): LoadedRule | null {
    if (!this.globalFile || !existsSync(this.globalFile)) return null;

    const mtime = statSync(this.globalFile).mtimeMs;
    if (mtime === this.globalFileTimestamp) {
      // Return cached global rule if present
      const cached = this.cache.get('__global__');
      if (cached && cached.length > 0) return cached[0]!;
    }
    this.globalFileTimestamp = mtime;

    try {
      const parsed = this.parseRuleFile(this.globalFile, '');
      if (parsed) {
        // Force global file to always mode regardless of frontmatter
        const globalRule: LoadedRule = { ...parsed, mode: 'always' };
        this.cache.set('__global__', [globalRule]);
        return globalRule;
      }
    } catch {
      // skip unparseable file
    }
    return null;
  }

  private loadDirectory(dir: string): LoadedRule[] {
    // Check cache freshness
    const cacheKey = dir;
    const cached = this.cache.get(cacheKey);
    if (cached && !this.hasChanges(dir)) return cached;

    const rules: LoadedRule[] = [];
    if (!existsSync(dir)) return rules;

    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.md')) continue;
        const fullPath = join(dir, entry);
        if (!statSync(fullPath).isFile()) continue;

        try {
          const parsed = this.parseRuleFile(fullPath, dir);
          if (parsed) rules.push(parsed);
        } catch {
          // skip unparseable files
        }
      }
    } catch {
      // directory read failed
    }

    this.cache.set(cacheKey, rules);
    return rules;
  }

  private parseRuleFile(fullPath: string, rulesDir: string): LoadedRule | null {
    const raw = readFileSync(fullPath, 'utf-8');
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const relPath = relative(rulesDir, fullPath);

    // Parse YAML frontmatter (minimal parser — no dependency)
    const fm = this.parseFrontmatter(raw);
    const content = this.stripFrontmatter(raw);

    if (!content.trim()) return null; // empty rule

    const mode =
      fm.alwaysApply === true || (!fm.globs && !fm.description)
        ? 'always'
        : fm.globs && fm.globs.length > 0
          ? 'auto'
          : 'on-demand';

    return { path: relPath, content, frontmatter: fm, hash, mode };
  }

  private parseFrontmatter(raw: string): RuleFrontmatter {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yamlBlock = match[1]!;
    const result: RuleFrontmatter = {};

    // Minimal YAML parser for our simple needs
    for (const line of yamlBlock.split('\n')) {
      const kvMatch = line.match(/^(\w+):\s*(.+)$/);
      if (!kvMatch) continue;

      const key = kvMatch[1]!;
      const value = kvMatch[2]!.trim();

      switch (key) {
        case 'description':
          result.description = value.replace(/^['"]|['"]$/g, '');
          break;
        case 'alwaysApply':
          result.alwaysApply = value === 'true';
          break;
        case 'tags':
          result.tags = value
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          break;
        case 'globs':
          // Parse YAML array: [a, b] or multi-line list
          if (value.startsWith('[')) {
            result.globs = value
              .replace(/^\[|\]$/g, '')
              .split(',')
              .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
              .filter(Boolean);
          }
          break;
      }
    }

    return result;
  }

  private stripFrontmatter(raw: string): string {
    return raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  }

  private filterByContext(rules: LoadedRule[], ctx?: RulesContext): LoadedRule[] {
    if (!ctx) return rules;

    const activeSet = new Set(ctx.activeFiles ?? []);
    const requestedSet = new Set(ctx.requestedRules ?? []);

    return rules.filter((rule) => {
      // alwaysApply → always included
      if (rule.mode === 'always') return true;

      // Explicitly requested → included
      if (requestedSet.has(rule.path)) return true;

      // Globs defined → check if any active file matches
      if (rule.mode === 'auto' && rule.frontmatter.globs) {
        return rule.frontmatter.globs.some((pattern) =>
          [...activeSet].some((file) => globMatch(pattern, file)),
        );
      }

      // on-demand → not loaded unless requested
      return false;
    });
  }

  private hasChanges(dir: string): boolean {
    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.md')) continue;
        const fullPath = join(dir, entry);
        const mtime = statSync(fullPath).mtimeMs;
        const prev = this.fileTimestamps.get(fullPath);
        if (prev !== mtime) {
          this.fileTimestamps.set(fullPath, mtime);
          return true;
        }
      }
    } catch {
      return true; // if we can't read, assume changed
    }
    return false;
  }
}
