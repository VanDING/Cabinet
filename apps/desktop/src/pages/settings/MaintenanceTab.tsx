import { useState } from 'react';
import { Button } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';

// ── Maintenance Tab (Garbage Collection) ──
interface GCIssueItem {
  category: string;
  severity: string;
  description: string;
  location: string;
  suggestedFix?: string;
  autoFixable: boolean;
}

export function MaintenanceTab() {
  const [scanning, setScanning] = useState(false);
  const [lastReport, setLastReport] = useState<any>(null);
  const [issues, setIssues] = useState<GCIssueItem[]>([]);
  const [summary, setSummary] = useState<string>('');

  const handleScan = async () => {
    setScanning(true);
    setSummary('');
    try {
      const r = await apiFetch('/api/gc/scan', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ autoFix: false }),
      });
      const d = await r.json();
      setLastReport(d.report);
      setIssues(d.report?.issues ?? []);
      setSummary(d.summary ?? '');
    } catch (e) {
      setSummary(`Scan failed: ${(e as Error).message}`);
    }
    setScanning(false);
  };

  const severityColor = (s: string) =>
    s === 'error'
      ? 'text-intent-danger bg-intent-danger-muted'
      : s === 'warning'
        ? 'text-intent-warning bg-intent-warning-muted'
        : 'text-accent bg-accent-muted';

  const categoryLabel = (c: string) =>
    c === 'orphan_file'
      ? 'Orphan File'
      : c === 'dead_code'
        ? 'Dead Code'
        : c === 'doc_drift'
          ? 'Doc Drift'
          : c === 'expired_data'
            ? 'Expired Data'
            : c === 'duplicate'
              ? 'Duplicate'
              : c;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-content-primary text-lg font-semibold">System Maintenance</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('open_devtools');
              } catch {
                console.log('DevTools: press F12 in browser');
              }
            }}
          >
            Open DevTools
          </Button>
          <Button size="sm" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Run GC Scan'}
          </Button>
        </div>
      </div>

      {lastReport && (
        <div className="mb-4 flex gap-4">
          <div className="border-border bg-surface-primary flex-1 rounded-lg border p-3 shadow-xs">
            <div className="text-content-primary text-2xl font-bold">
              {lastReport.summary?.total ?? 0}
            </div>
            <div className="text-content-tertiary text-xs">Total Issues</div>
          </div>
          <div className="border-border bg-surface-primary flex-1 rounded-lg border p-3 shadow-xs">
            <div className="text-intent-danger text-2xl font-bold">
              {lastReport.summary?.errors ?? 0}
            </div>
            <div className="text-content-tertiary text-xs">Errors</div>
          </div>
          <div className="border-border bg-surface-primary flex-1 rounded-lg border p-3 shadow-xs">
            <div className="text-intent-warning text-2xl font-bold">
              {lastReport.summary?.warnings ?? 0}
            </div>
            <div className="text-content-tertiary text-xs">Warnings</div>
          </div>
          <div className="border-border bg-surface-primary flex-1 rounded-lg border p-3 shadow-xs">
            <div className="text-content-tertiary text-2xl font-bold">
              {lastReport.filesScanned ?? 0}
            </div>
            <div className="text-content-tertiary text-xs">Files Scanned</div>
          </div>
        </div>
      )}

      {summary && (
        <div className="border-border bg-surface-primary mb-4 rounded-lg border p-4 shadow-xs">
          <pre className="text-content-secondary font-mono text-xs whitespace-pre-wrap">
            {summary}
          </pre>
        </div>
      )}

      {issues.length > 0 && (
        <div className="space-y-2">
          {issues.slice(0, 20).map((issue, i) => (
            <div
              key={i}
              className="border-border bg-surface-primary rounded-lg border p-3 shadow-xs"
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColor(issue.severity)}`}
                >
                  {issue.severity.toUpperCase()}
                </span>
                <span className="text-content-tertiary text-xs">
                  {categoryLabel(issue.category)}
                </span>
                {issue.autoFixable && (
                  <span className="text-intent-success text-xs">auto-fixable</span>
                )}
              </div>
              <p className="text-content-primary text-sm">{issue.description}</p>
              <p className="text-content-tertiary mt-1 font-mono text-xs">{issue.location}</p>
              {issue.suggestedFix && (
                <p className="text-accent mt-1 text-xs">Fix: {issue.suggestedFix}</p>
              )}
            </div>
          ))}
          {issues.length > 20 && (
            <p className="text-content-tertiary py-2 text-center text-xs">
              ... and {issues.length - 20} more issues
            </p>
          )}
        </div>
      )}

      {!lastReport && !scanning && (
        <p className="text-content-tertiary py-4 text-sm">
          Run a garbage collection scan to detect dead code, orphan files, expired data, and
          documentation drift.
        </p>
      )}
    </div>
  );
}
