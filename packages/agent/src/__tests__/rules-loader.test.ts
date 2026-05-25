import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RulesLoader } from '../rules-loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `rules-loader-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('RulesLoader summarize cache', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    writeFileSync(join(tempDir, 'always.md'), '---\nalwaysApply: true\n---\nAlways rule.\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('caches summarize result across calls', () => {
    const loader = new RulesLoader([tempDir]);
    const s1 = loader.summarize();
    const s2 = loader.summarize();
    expect(s1).toBe(s2);
  });

  it('invalidates summary cache after reload', () => {
    const loader = new RulesLoader([tempDir]);
    const s1 = loader.summarize();
    writeFileSync(join(tempDir, 'new.md'), '---\nalwaysApply: true\n---\nNew rule.\n');
    loader.reload();
    const s2 = loader.summarize();
    expect(s2).toContain('new.md');
    expect(s1).not.toBe(s2);
  });
});
