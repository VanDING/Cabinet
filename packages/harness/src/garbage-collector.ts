//
// Garbage Collector — background cleanup for code entropy accumulation.
//
// Code entropy is one of the three cross-case common problems identified in the
// Harness Engineering article. AI agents generate code rapidly, and without
// regular cleanup, the codebase accumulates:
//   - Stale references and dead code
//   - Expired memory/checkpoint data
//   - Documentation drift
//   - Duplicate implementations
//
// Inspired by OpenAI's background cleanup Agent that periodically scans for
// documentation inconsistencies, architecture violations, and redundant code,
// then automatically submits cleanup PRs.
//
// The Garbage Collector is designed to be run:
//   - On a schedule (e.g., daily via Cron)
//   - After major feature work (triggered by the Generator)
//   - Manually by the Captain
//

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

// ── Types ──────────────────────────────────────────────────────

export type GCIssueSeverity = 'info' | 'warning' | 'error';
export type GCIssueCategory =
  | 'stale_reference'
  | 'dead_code'
  | 'doc_drift'
  | 'duplicate'
  | 'expired_data'
  | 'orphan_file';

export interface GCIssue {
  category: GCIssueCategory;
  severity: GCIssueSeverity;
  /** Human-readable description. */
  description: string;
  /** File or resource path. */
  location: string;
  /** Suggested fix, if auto-fixable. */
  suggestedFix?: string;
  /** Whether this can be cleaned automatically. */
  autoFixable: boolean;
}

export interface GCReport {
  timestamp: string;
  scanDurationMs: number;
  filesScanned: number;
  issues: GCIssue[];
  /** Issues grouped by category. */
  byCategory: Record<GCIssueCategory, GCIssue[]>;
  /** Issues grouped by severity. */
  bySeverity: Record<GCIssueSeverity, GCIssue[]>;
  /** Summary count. */
  summary: { total: number; errors: number; warnings: number; infos: number };
}

export interface GCOptions {
  /** Root directory to scan. */
  rootDir: string;
  /** Directories to exclude from scan. */
  excludeDirs?: string[];
  /** File patterns to exclude. */
  excludePatterns?: RegExp[];
  /** Whether to auto-fix issues that are autoFixable. */
  autoFix?: boolean;
  /** Max files to scan (safety limit). */
  maxFiles?: number;
}

// ── Garbage Collector ──────────────────────────────────────────

export class GarbageCollector {
  private readonly options: Required<GCOptions>;

  constructor(
    private readonly eventBus: EventBus,
    options: GCOptions,
  ) {
    this.options = {
      rootDir: options.rootDir,
      excludeDirs: options.excludeDirs ?? [
        'node_modules',
        'dist',
        '.git',
        'target',
        '.fingerprint',
        '.claude',
        '.cabinet',
      ],
      excludePatterns: options.excludePatterns ?? [/\.tsbuildinfo$/, /\.snap$/, /\.lock$/],
      autoFix: options.autoFix ?? false,
      maxFiles: options.maxFiles ?? 5000,
    };
  }

  /** Run a full garbage collection scan. */
  async collect(): Promise<GCReport> {
    const startTime = Date.now();
    const issues: GCIssue[] = [];

    // Phase 1: File system scan
    const files = this.collectFiles(this.options.rootDir);
    const filesScanned = files.length;

    // Phase 2: Check for stale/dead references
    issues.push(...this.checkOrphanFiles(files));
    issues.push(...this.checkDeadCode(files));
    issues.push(...this.checkDocDrift(files));

    // Phase 3: Check for expired data in .cabinet/
    issues.push(...this.checkExpiredData());

    // Phase 4: Check for duplicate implementations
    issues.push(...this.checkDuplicates(files));

    // Build report
    const byCategory = this.groupBy(issues, 'category') as Record<GCIssueCategory, GCIssue[]>;
    const bySeverity = this.groupBy(issues, 'severity') as Record<GCIssueSeverity, GCIssue[]>;

    const report: GCReport = {
      timestamp: new Date().toISOString(),
      scanDurationMs: Date.now() - startTime,
      filesScanned,
      issues,
      byCategory,
      bySeverity,
      summary: {
        total: issues.length,
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        infos: issues.filter((i) => i.severity === 'info').length,
      },
    };

    // Publish report
    await this.eventBus.publish({
      messageId: `gc_report_${Date.now()}`,
      correlationId: `gc_${Date.now()}`,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'garbage_collection',
        data: {
          summary: report.summary,
          topIssues: issues.slice(0, 10).map((i) => ({
            category: i.category,
            severity: i.severity,
            description: i.description,
            location: i.location,
          })),
        },
      },
    });

    // Auto-fix if enabled
    if (this.options.autoFix) {
      await this.autoFix(issues.filter((i) => i.autoFixable));
    }

    return report;
  }

  /** Generate a human-readable summary of issues found. */
  static summarize(report: GCReport): string {
    const lines: string[] = [
      `## Garbage Collection Report — ${report.timestamp}`,
      '',
      `Scanned ${report.filesScanned} files in ${(report.scanDurationMs / 1000).toFixed(1)}s.`,
      `Found ${report.summary.total} issues: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos.`,
      '',
    ];

    if (report.summary.total === 0) {
      lines.push('✅ No issues found.');
      return lines.join('\n');
    }

    for (const [category, issueList] of Object.entries(report.byCategory)) {
      if (issueList.length === 0) continue;
      lines.push(`### ${category} (${issueList.length})`);
      for (const issue of issueList.slice(0, 5)) {
        const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
        lines.push(`- ${icon} ${issue.description}`);
        lines.push(`  Location: ${issue.location}`);
        if (issue.suggestedFix) lines.push(`  Fix: ${issue.suggestedFix}`);
      }
      if (issueList.length > 5) lines.push(`  ... and ${issueList.length - 5} more`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Private Checks ────────────────────────────────────────

  private collectFiles(dir: string): string[] {
    const files: string[] = [];
    if (!existsSync(dir)) return files;

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (this.options.excludeDirs.includes(entry.name)) continue;
          files.push(...this.collectFiles(fullPath));
        } else if (entry.isFile()) {
          if (this.options.excludePatterns.some((p) => p.test(entry.name))) continue;
          if (files.length >= this.options.maxFiles) break;
          files.push(fullPath);
        }
      }
    } catch {
      // permission issues — skip
    }

    return files;
  }

  private checkOrphanFiles(files: string[]): GCIssue[] {
    const issues: GCIssue[] = [];
    const relFiles = files.map((f) => relative(this.options.rootDir, f));

    // Check for orphaned test files (test file exists but source file doesn't)
    for (const file of relFiles) {
      if (file.includes('__tests__') && (file.endsWith('.test.ts') || file.endsWith('.test.tsx'))) {
        // Extract the source file name
        const sourceName = file
          .replace('/__tests__/', '/')
          .replace('.test.ts', '.ts')
          .replace('.test.tsx', '.tsx');

        const sourceAbsPath = join(this.options.rootDir, sourceName);
        const testAbsPath = join(this.options.rootDir, file);

        if (!existsSync(sourceAbsPath)) {
          const age = this.fileAge(testAbsPath);
          if (age > 30) {
            // older than 30 days
            issues.push({
              category: 'orphan_file',
              severity: 'warning',
              description: `Test file without corresponding source: ${file}`,
              location: file,
              suggestedFix: `Remove ${file} or create ${sourceName}`,
              autoFixable: false,
            });
          }
        }
      }
    }

    return issues;
  }

  private checkDeadCode(files: string[]): GCIssue[] {
    const issues: GCIssue[] = [];

    // Check for files with only comments and exports (likely dead)
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n').filter((l) => {
          const trimmed = l.trim();
          return (
            trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && trimmed !== '*/'
          );
        });

        // Files that only export (re-export barrels with no implementation)
        if (lines.length > 0 && lines.every((l) => l.startsWith('export'))) {
          // This is a barrel file — only flag if it re-exports nothing
          const exportCount = lines.filter((l) => l.includes(' from ')).length;
          if (exportCount === 0 && lines.length <= 2) {
            issues.push({
              category: 'dead_code',
              severity: 'info',
              description: `Potentially dead barrel file: ${relative(this.options.rootDir, file)}`,
              location: relative(this.options.rootDir, file),
              suggestedFix: 'Remove file if no longer needed.',
              autoFixable: false,
            });
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    return issues;
  }

  private checkDocDrift(files: string[]): GCIssue[] {
    const issues: GCIssue[] = [];
    const relFiles = files.map((f) => relative(this.options.rootDir, f));

    // Check for .cabinet/rules/ files that reference non-existent files
    const rulesFiles = relFiles.filter((f) => f.startsWith('.cabinet/rules/') && f.endsWith('.md'));
    for (const rulesFile of rulesFiles) {
      try {
        const content = readFileSync(join(this.options.rootDir, rulesFile), 'utf-8');
        // Extract file path references
        const refs = content.match(/`([^`]+\.(ts|tsx|js|json|md))`/g) ?? [];
        for (const ref of refs) {
          const path = ref.replace(/`/g, '');
          if (!existsSync(join(this.options.rootDir, path))) {
            issues.push({
              category: 'doc_drift',
              severity: 'warning',
              description: `Rule file references non-existent path: ${path}`,
              location: rulesFile,
              suggestedFix: `Update or remove reference to ${path} in ${rulesFile}`,
              autoFixable: false,
            });
          }
        }
      } catch {
        // skip
      }
    }

    return issues;
  }

  private checkExpiredData(): GCIssue[] {
    const issues: GCIssue[] = [];
    const cabinetDir = join(this.options.rootDir, '.cabinet');

    if (!existsSync(cabinetDir)) return issues;

    // Check for old progress archives (>90 days)
    const progressDir = join(cabinetDir, 'progress');
    if (existsSync(progressDir)) {
      try {
        for (const entry of readdirSync(progressDir)) {
          const fullPath = join(progressDir, entry);
          const age = this.fileAge(fullPath);
          if (age > 90) {
            issues.push({
              category: 'expired_data',
              severity: 'info',
              description: `Progress archive older than 90 days: ${entry}`,
              location: `.cabinet/progress/${entry}`,
              suggestedFix: 'Archive to cold storage or delete.',
              autoFixable: true,
            });
          }
        }
      } catch {
        /* skip */
      }
    }

    return issues;
  }

  private checkDuplicates(files: string[]): GCIssue[] {
    const issues: GCIssue[] = [];
    const hashToFiles = new Map<string, string[]>();

    // Only check source files — build artifacts and config files produce false
    // positives because they share similar structure (e.g. Cargo fingerprint JSON).
    const sourceExts = new Set([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.rs',
      '.py',
      '.go',
      '.java',
      '.kt',
      '.swift',
      '.cpp',
      '.c',
      '.h',
      '.hpp',
    ]);

    for (const file of files) {
      if (!sourceExts.has(extname(file).toLowerCase())) continue;

      try {
        const stat = statSync(file);
        if (stat.size < 100) continue; // skip tiny files
        const content = readFileSync(file, 'utf-8').slice(0, 200);
        const key = `${stat.size}-${content}`;
        const existing = hashToFiles.get(key) ?? [];
        existing.push(relative(this.options.rootDir, file));
        hashToFiles.set(key, existing);
      } catch {
        // skip
      }
    }

    // Report files with identical size+prefix
    for (const [, fileList] of hashToFiles) {
      if (fileList.length >= 2) {
        issues.push({
          category: 'duplicate',
          severity: 'warning',
          description: `Potential duplicate files (same size and prefix): ${fileList.join(', ')}`,
          location: fileList[0]!,
          suggestedFix: 'Review and consolidate duplicate implementations.',
          autoFixable: false,
        });
      }
    }

    return issues;
  }

  // ── Helpers ────────────────────────────────────────────────

  private fileAge(path: string): number {
    try {
      const mtime = statSync(path).mtimeMs;
      return (Date.now() - mtime) / (1000 * 60 * 60 * 24); // days
    } catch {
      return 0;
    }
  }

  private groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
    const result: Record<string, T[]> = {};
    for (const item of items) {
      const k = String(item[key]);
      (result[k] ??= []).push(item);
    }
    return result;
  }

  private async autoFix(issues: GCIssue[]): Promise<void> {
    for (const issue of issues) {
      if (issue.category === 'expired_data') {
        try {
          const { rename, mkdir } = await import('node:fs/promises');
          const src = join(this.options.rootDir, issue.location);
          const trashDir = join(this.options.rootDir, '.trash');
          await mkdir(trashDir, { recursive: true });
          const dest = join(trashDir, `${Date.now()}_${issue.location.replace(/[\\/]/g, '_')}`);
          await rename(src, dest);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }
}
