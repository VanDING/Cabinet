/**
 * Architectural Linter — enforces the 4-layer dependency rule.
 *
 * Layer 1 (Infra):    types, events, storage       → may only import Layer 1
 * Layer 2 (Agent):    gateway, agent, memory        → may import Layer 1–2
 * Layer 3 (Business): decision, secretary, meeting,  → may import Layer 1–3
 *                       workflow, harness
 * Layer 4 (Interface): ui, server, desktop           → may import Layer 1–4
 *
 * Each error includes a FIX instruction telling the developer (or agent)
 * exactly how to resolve the violation.
 *
 * Usage:  tsx tools/arch-lint.ts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const APPS_DIR = join(ROOT, 'apps');

// ── Layer definitions ──────────────────────────────────────────

const LAYERS: Record<number, string[]> = {
  1: ['@cabinet/types', '@cabinet/events', '@cabinet/storage'],
  2: ['@cabinet/gateway', '@cabinet/agent', '@cabinet/memory'],
  3: [
    '@cabinet/decision',
    '@cabinet/secretary',
    '@cabinet/meeting',
    '@cabinet/workflow',
    '@cabinet/harness',
  ],
  4: ['@cabinet/ui', '@cabinet/server', '@cabinet/desktop'],
};

// Specific packages that are banned from importing certain packages
const BANNED_IMPORTS: Record<string, { packages: string[]; reason: string }> = {
  '@cabinet/ui': {
    packages: ['better-sqlite3'],
    reason:
      'Frontend packages must not access the database directly. Use @cabinet/storage through API routes.',
  },
  '@cabinet/desktop': {
    packages: ['better-sqlite3'],
    reason:
      'Frontend packages must not access the database directly. Use @cabinet/storage through API routes.',
  },
};

function getLayer(packageName: string): number {
  for (const [layer, pkgs] of Object.entries(LAYERS)) {
    if (pkgs.includes(packageName)) return Number(layer);
  }
  return -1; // external package
}

function getAllPackages(): { name: string; path: string; layer: number }[] {
  const results: { name: string; path: string; layer: number }[] = [];

  for (const dir of [PACKAGES_DIR, APPS_DIR]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(dir, entry.name, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { name?: string };
        if (!pkg.name) continue;
        const layer = getLayer(pkg.name);
        results.push({ name: pkg.name, path: join(dir, entry.name), layer });
      } catch {
        // skip malformed package.json
      }
    }
  }
  return results;
}

function findSourceFiles(pkgPath: string): string[] {
  const srcDir = join(pkgPath, 'src');
  if (!existsSync(srcDir)) return [];

  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
      if (entry.name.startsWith('__tests__')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(full);
      }
    }
  }
  walk(srcDir);
  return files;
}

function extractImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const imports: string[] = [];

  // Match: import ... from 'package' or import ... from '@scope/package'
  const importRegex = /import\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1]!;
    // Only track @cabinet/* and better-sqlite3 imports
    if (specifier.startsWith('@cabinet/') || specifier === 'better-sqlite3') {
      imports.push(specifier);
    }
  }
  return [...new Set(imports)];
}

// ── Violation types ────────────────────────────────────────────

interface Violation {
  file: string;
  importer: string;
  importee: string;
  importerLayer: number;
  importeeLayer: number;
  message: string;
  fix: string;
}

function checkFile(filePath: string, pkgName: string, pkgLayer: number): Violation[] {
  const violations: Violation[] = [];
  const imports = extractImports(filePath);

  for (const imp of imports) {
    const impLayer = getLayer(imp);

    // ── Layer violation ──
    if (impLayer !== -1 && impLayer > pkgLayer) {
      const layerNames: Record<number, string> = {
        1: 'Infra (types/events/storage)',
        2: 'Agent Core (gateway/agent/memory)',
        3: 'Business (decision/secretary/meeting/workflow/harness)',
        4: 'Interface (ui/server/desktop)',
      };
      violations.push({
        file: filePath,
        importer: pkgName,
        importee: imp,
        importerLayer: pkgLayer,
        importeeLayer: impLayer,
        message: `${pkgName} (Layer ${pkgLayer}: ${layerNames[pkgLayer]}) imports ${imp} (Layer ${impLayer}: ${layerNames[impLayer]}). Layer ${pkgLayer} must not depend on Layer ${impLayer}.`,
        fix: [
          `To fix: move the shared logic to a Layer ${pkgLayer} or lower package, OR:`,
          `  1. If the type/interface can be defined locally → copy it to ${pkgName}`,
          `  2. If it belongs in @cabinet/types → move the type definition there (Layer 1, allowed from any layer)`,
          `  3. If it's business logic → invert the dependency: have Layer ${impLayer} call into Layer ${pkgLayer}, not the reverse`,
        ].join('\n'),
      });
    }

    // ── Banned import ──
    const banned = BANNED_IMPORTS[pkgName];
    if (banned?.packages.includes(imp)) {
      violations.push({
        file: filePath,
        importer: pkgName,
        importee: imp,
        importerLayer: pkgLayer,
        importeeLayer: -1,
        message: `${pkgName} imports banned package ${imp}. ${banned.reason}`,
        fix: `To fix: ${banned.reason}`,
      });
    }
  }

  return violations;
}

// ── Main ───────────────────────────────────────────────────────

function main(): void {
  const packages = getAllPackages();
  const violations: Violation[] = [];

  for (const pkg of packages) {
    const files = findSourceFiles(pkg.path);
    for (const file of files) {
      violations.push(...checkFile(file, pkg.name, pkg.layer));
    }
  }

  if (violations.length === 0) {
    console.log('✓ Architecture check passed — no layer violations found.');
    process.exit(0);
  }

  // Group violations by importer
  const byImporter = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = byImporter.get(v.importer) ?? [];
    existing.push(v);
    byImporter.set(v.importer, existing);
  }

  console.log(`\n✗ ${violations.length} architecture violation(s) found:\n`);

  for (const [pkg, pkgViolations] of byImporter) {
    console.log(`── ${pkg} (${pkgViolations.length} violations) ──`);
    for (const v of pkgViolations) {
      console.log(`\n  ✗ ${v.message}`);
      console.log(`  ${v.fix}`);
      console.log(`    File: ${v.file}`);
    }
  }

  console.log('\n');
  process.exit(1);
}

main();
