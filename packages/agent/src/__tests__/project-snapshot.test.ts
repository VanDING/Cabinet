import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectSnapshot } from '../project-snapshot.js';

describe('ProjectSnapshot caching', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `project-snapshot-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), '{}');
    writeFileSync(join(tempDir, 'README.md'), '# Test');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('caches by project root, not session id', () => {
    const s1 = ProjectSnapshot.capture(tempDir);
    ProjectSnapshot.store(tempDir, s1);

    const cached = ProjectSnapshot.getCached(tempDir);
    expect(cached).not.toBeNull();
    expect(cached!.root).toBe(tempDir);

    // Different session id should still hit the same cache
    const cachedAgain = ProjectSnapshot.getCached(tempDir);
    expect(cachedAgain).toBe(cached);
  });

  it('returns null for uncached root', () => {
    const uncached = ProjectSnapshot.getCached(join(tempDir, 'nonexistent'));
    expect(uncached).toBeNull();
  });
});
