import { useState } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

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
      ? 'text-red-600 bg-red-50 dark:bg-red-900 dark:text-red-300'
      : s === 'warning'
        ? 'text-amber-600 bg-amber-50 dark:bg-amber-900 dark:text-amber-300'
        : 'text-blue-600 bg-blue-50 dark:bg-blue-900 dark:text-blue-300';

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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          System Maintenance
        </h2>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('open_devtools');
              } catch {
                // Tauri API not available (browser mode)
                console.log('DevTools: press F12 in browser');
              }
            }}
            className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Open DevTools
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Run GC Scan'}
          </button>
        </div>
      </div>

      {lastReport && (
        <div className="mb-4 flex gap-4">
          <div className="flex-1 rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {lastReport.summary?.total ?? 0}
            </div>
            <div className="text-xs text-gray-500">Total Issues</div>
          </div>
          <div className="flex-1 rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-2xl font-bold text-red-600">{lastReport.summary?.errors ?? 0}</div>
            <div className="text-xs text-gray-500">Errors</div>
          </div>
          <div className="flex-1 rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-2xl font-bold text-amber-600">
              {lastReport.summary?.warnings ?? 0}
            </div>
            <div className="text-xs text-gray-500">Warnings</div>
          </div>
          <div className="flex-1 rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-500">{lastReport.filesScanned ?? 0}</div>
            <div className="text-xs text-gray-500">Files Scanned</div>
          </div>
        </div>
      )}

      {summary && (
        <div className="mb-4 rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700 dark:text-gray-300">
            {summary}
          </pre>
        </div>
      )}

      {issues.length > 0 && (
        <div className="space-y-2">
          {issues.slice(0, 20).map((issue, i) => (
            <div
              key={i}
              className="rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColor(issue.severity)}`}
                >
                  {issue.severity.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">{categoryLabel(issue.category)}</span>
                {issue.autoFixable && <span className="text-xs text-green-600">auto-fixable</span>}
              </div>
              <p className="text-sm text-gray-900 dark:text-gray-100">{issue.description}</p>
              <p className="mt-1 font-mono text-xs text-gray-400">{issue.location}</p>
              {issue.suggestedFix && (
                <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                  Fix: {issue.suggestedFix}
                </p>
              )}
            </div>
          ))}
          {issues.length > 20 && (
            <p className="py-2 text-center text-xs text-gray-500">
              ... and {issues.length - 20} more issues
            </p>
          )}
        </div>
      )}

      {!lastReport && !scanning && (
        <p className="py-4 text-sm text-gray-400">
          Run a garbage collection scan to detect dead code, orphan files, expired data, and
          documentation drift.
        </p>
      )}
    </div>
  );
}
