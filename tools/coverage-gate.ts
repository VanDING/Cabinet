#!/usr/bin/env tsx
/**
 * Coverage gate — checks that the current coverage meets or exceeds baseline.
 *
 * Usage:
 *   pnpm exec tsx tools/coverage-gate.ts              # check against baseline
 *   pnpm exec tsx tools/coverage-gate.ts --update     # update baseline from current
 *   pnpm exec tsx tools/coverage-gate.ts --summary    # print current summary
 *
 * CI flow:
 *   1. pnpm test:coverage            # generates coverage/coverage-summary.json
 *   2. pnpm exec tsx tools/coverage-gate.ts  # fails if coverage dropped
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';

// Resolve project root from script location
import { fileURLToPath } from 'node:url';
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const BASELINE_PATH = join(ROOT, 'coverage', 'baseline.json');
const SUMMARY_PATH = join(ROOT, 'coverage', 'coverage-summary.json');

// ── Resolve summary files ──
// Per-package coverage: each package writes to its own coverage/ directory.
// Collect all coverage-summary.json files from packages/* and apps/*.

interface CoverageMetrics {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

function findAllSummaryPaths(): string[] {
  const paths: string[] = [];

  // Try root-level summary first (vitest workspace mode)
  if (existsSync(SUMMARY_PATH)) paths.push(SUMMARY_PATH);

  // Collect per-package summaries
  for (const scope of ['packages', 'apps']) {
    const scopeDir = join(ROOT, scope);
    if (!existsSync(scopeDir)) continue;
    for (const sub of readdirSync(scopeDir)) {
      const summaryPath = join(scopeDir, sub, 'coverage', 'coverage-summary.json');
      if (existsSync(summaryPath)) paths.push(summaryPath);
    }
  }

  return paths;
}

function parseSummary(path: string): { total: CoverageMetrics } | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.total) return null;
    const t = data.total;
    return {
      total: {
        lines: round(t.lines?.pct ?? 0),
        functions: round(t.functions?.pct ?? 0),
        branches: round(t.branches?.pct ?? 0),
        statements: round(t.statements?.pct ?? 0),
      },
    };
  } catch {
    return null;
  }
}

function aggregateSummaries(paths: string[]): { total: CoverageMetrics; perPackage: Map<string, CoverageMetrics> } {
  const perPackage = new Map<string, CoverageMetrics>();
  let totalLines = 0, totalFunctions = 0, totalBranches = 0, totalStatements = 0;
  let count = 0;

  for (const p of paths) {
    const parsed = parseSummary(p);
    if (!parsed) continue;
    // Extract package name from path
    const match = p.match(/(?:packages|apps)\/([^/]+)/);
    const name = match?.[1] ?? p;
    perPackage.set(name, parsed.total);
    totalLines += parsed.total.lines;
    totalFunctions += parsed.total.functions;
    totalBranches += parsed.total.branches;
    totalStatements += parsed.total.statements;
    count++;
  }

  return {
    total: {
      lines: count > 0 ? round(totalLines / count) : 0,
      functions: count > 0 ? round(totalFunctions / count) : 0,
      branches: count > 0 ? round(totalBranches / count) : 0,
      statements: count > 0 ? round(totalStatements / count) : 0,
    },
    perPackage,
  };
}

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

// ── Check against thresholds ──

const MIN_THRESHOLDS: CoverageMetrics = {
  lines: 20,
  functions: 15,
  branches: 10,
  statements: 20,
};

function checkThresholds(current: CoverageMetrics): string[] {
  const failures: string[] = [];
  for (const [key, min] of Object.entries(MIN_THRESHOLDS) as [keyof CoverageMetrics, number][]) {
    if (current[key] < min) {
      failures.push(`${key}: ${current[key]}% (min: ${min}%)`);
    }
  }
  return failures;
}

// ── Compare against baseline ──

function checkBaseline(current: CoverageMetrics, baseline: CoverageMetrics): string[] {
  const drops: string[] = [];
  for (const key of ['lines', 'functions', 'branches', 'statements'] as const) {
    const diff = current[key] - baseline[key];
    if (diff < -0.5) {
      drops.push(`${key}: ${current[key]}% (was: ${baseline[key]}%, drop: ${diff.toFixed(2)}%)`);
    }
  }
  return drops;
}

// ── Main ──

const mode = argv.includes('--update') ? 'update'
  : argv.includes('--summary') ? 'summary'
  : 'check';

if (mode === 'update') {
  // Generate baseline from current coverage
  const paths = findAllSummaryPaths();
  if (paths.length === 0) {
    console.error('[coverage-gate] No coverage summaries found. Run coverage first.');
    process.exit(1);
  }
  const { total, perPackage } = aggregateSummaries(paths);

  mkdirSync(join(ROOT, 'coverage'), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        total,
        packages: Object.fromEntries(perPackage),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`[coverage-gate] Baseline updated from ${perPackage.size} packages:`);
  console.log(`  Lines:      ${total.lines}%`);
  console.log(`  Functions:  ${total.functions}%`);
  console.log(`  Branches:   ${total.branches}%`);
  console.log(`  Statements: ${total.statements}%`);
  process.exit(0);
}

if (mode === 'summary') {
  const paths = findAllSummaryPaths();
  const { total, perPackage } = aggregateSummaries(paths);
  console.log(`Aggregate coverage from ${perPackage.size} packages:`);
  console.log(`  Lines:      ${total.lines}%`);
  console.log(`  Functions:  ${total.functions}%`);
  console.log(`  Branches:   ${total.branches}%`);
  console.log(`  Statements: ${total.statements}%`);

  // Also show per-package
  for (const [name, m] of [...perPackage].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${name}: lines=${m.lines}% funcs=${m.functions}% branches=${m.branches}% stmts=${m.statements}%`);
  }

  const thresholdFailures = checkThresholds(total);
  if (thresholdFailures.length > 0) {
    console.log('\n⚠  Below minimum thresholds:');
    for (const f of thresholdFailures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

// mode === 'check'
const paths = findAllSummaryPaths();
if (paths.length === 0) {
  console.error('[coverage-gate] No coverage summaries found. Run coverage first.');
  process.exit(1);
}
const { total } = aggregateSummaries(paths);

// Check minimum thresholds
const thresholdFailures = checkThresholds(total);
if (thresholdFailures.length > 0) {
  console.error('[coverage-gate] ❌ Coverage below minimum thresholds:');
  for (const f of thresholdFailures) console.error(`  - ${f}`);
  process.exitCode = 1;
}

// Check against baseline (if exists)
if (existsSync(BASELINE_PATH)) {
  const baselineData = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  const baseline: CoverageMetrics = baselineData.total;

  if (baseline) {
    const drops = checkBaseline(total, baseline);

    if (drops.length > 0) {
      console.error('\n[coverage-gate] ❌ Coverage dropped from baseline:');
      for (const d of drops) console.error(`  - ${d}`);
      console.error('\n  If this drop is intentional, update the baseline:');
      console.error('    pnpm coverage:baseline');
      process.exitCode = 1;
    } else {
      console.log('[coverage-gate] ✅ Coverage meets or exceeds baseline.');
      console.log(`  Lines:      ${total.lines}% (baseline: ${baseline.lines}%)`);
      console.log(`  Functions:  ${total.functions}% (baseline: ${baseline.functions}%)`);
      console.log(`  Branches:   ${total.branches}% (baseline: ${baseline.branches}%)`);
      console.log(`  Statements: ${total.statements}% (baseline: ${baseline.statements}%)`);
    }
  }
} else {
  console.log('[coverage-gate] ⚠  No baseline found. Create one with:');
  console.log('  pnpm coverage:baseline');
  // First run — only enforce minimum thresholds, not baseline diff
  if (process.exitCode !== 1) {
    console.log('[coverage-gate] ✅ Coverage meets minimum thresholds.');
  }
}

process.exit(process.exitCode || 0);
