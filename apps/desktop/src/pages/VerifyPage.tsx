import { useState } from 'react';
import { apiFetch, authJsonHeaders } from '../utils/pin.js';

interface VerificationCheck {
  name: string;
  path?: string;
  expectedText?: string;
  expectedElement?: string;
  waitFor?: string;
  screenshot?: boolean;
}

interface CheckResult {
  checkName: string;
  passed: boolean;
  error?: string;
  screenshotPath?: string;
  domPreview?: string;
  durationMs: number;
}

interface VerifyReport {
  timestamp: string;
  baseUrl: string;
  totalChecks: number;
  passedCount: number;
  failedCount: number;
  results: CheckResult[];
  allPassed: boolean;
}

const DEFAULT_CHECKS: VerificationCheck[] = [
  { name: 'Homepage loads', path: '/', expectedElement: 'body' },
  { name: 'Office page renders', path: '/office', expectedText: 'Dashboard' },
];

export function VerifyPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:5173');
  const [checks, setChecks] = useState<VerificationCheck[]>(DEFAULT_CHECKS);
  const [newCheck, setNewCheck] = useState<VerificationCheck>({ name: '', path: '/' });
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addCheck = () => {
    if (!newCheck.name.trim()) return;
    setChecks(prev => [...prev, { ...newCheck }]);
    setNewCheck({ name: '', path: '/' });
  };

  const removeCheck = (index: number) => {
    setChecks(prev => prev.filter((_, i) => i !== index));
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const res = await apiFetch('/api/verify/run', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ baseUrl, checks, headless: true }),
      });
      const data = await res.json();
      if (data.report) {
        setReport(data.report);
      } else {
        setError(data.error ?? 'Verification failed');
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setRunning(false);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Verification Center</h1>
        <button
          onClick={handleRun}
          disabled={running || checks.length === 0}
          className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run Verification'}
        </button>
      </div>

      {/* Base URL */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">App URL</label>
        <input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          className="w-full max-w-md border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          placeholder="http://localhost:5173"
        />
      </div>

      {/* Checks definition */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Checks</h2>

        {/* Existing checks */}
        {checks.length === 0 ? (
          <p className="text-gray-400 text-sm mb-3">No checks defined. Add one below.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {checks.map((check, i) => (
              <div key={i} className="flex items-center gap-3 border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
                <span className="text-xs text-gray-400 w-6">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{check.name}</div>
                  <div className="text-xs text-gray-500">
                    {check.path && <span className="mr-3">Path: {check.path}</span>}
                    {check.expectedText && <span className="mr-3">Text: "{check.expectedText}"</span>}
                    {check.expectedElement && <span className="mr-3">El: {check.expectedElement}</span>}
                    {check.waitFor && <span className="mr-3">Wait: {check.waitFor}</span>}
                    {check.screenshot && <span className="text-blue-500">📷 Screenshot</span>}
                  </div>
                </div>
                <button onClick={() => removeCheck(i)} className="text-xs text-red-500 hover:underline flex-shrink-0">Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* Add check form */}
        <div className="border dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Check name (required)"
              value={newCheck.name}
              onChange={e => setNewCheck(p => ({ ...p, name: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <input
              placeholder="Path (e.g. /office)"
              value={newCheck.path ?? ''}
              onChange={e => setNewCheck(p => ({ ...p, path: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <input
              placeholder="Expected text"
              value={newCheck.expectedText ?? ''}
              onChange={e => setNewCheck(p => ({ ...p, expectedText: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <input
              placeholder="Expected element (CSS selector)"
              value={newCheck.expectedElement ?? ''}
              onChange={e => setNewCheck(p => ({ ...p, expectedElement: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <input
              placeholder="Wait for selector"
              value={newCheck.waitFor ?? ''}
              onChange={e => setNewCheck(p => ({ ...p, waitFor: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <input type="checkbox" checked={newCheck.screenshot ?? false}
                onChange={e => setNewCheck(p => ({ ...p, screenshot: e.target.checked }))} />
              Take screenshot
            </label>
          </div>
          <button onClick={addCheck} disabled={!newCheck.name.trim()}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Add Check
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 border border-red-300 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {report && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Results</h2>
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${
              report.allPassed
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
            }`}>
              {report.allPassed ? 'ALL PASSED' : `${report.failedCount} FAILED`}
            </span>
            <span className="text-xs text-gray-500">
              {report.passedCount}/{report.totalChecks} passed · {report.timestamp}
            </span>
          </div>

          <div className="space-y-3">
            {report.results.map((result, i) => (
              <div key={i} className={`border rounded-lg p-4 ${
                result.passed
                  ? 'border-green-200 dark:border-green-800 bg-white dark:bg-gray-800'
                  : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
              }`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-lg ${result.passed ? '' : ''}`}>
                    {result.passed ? '✅' : '❌'}
                  </span>
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{result.checkName}</div>
                    <div className="text-xs text-gray-500">{result.durationMs}ms</div>
                  </div>
                </div>
                {result.error && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{result.error}</p>
                )}
                {result.domPreview && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer">DOM Preview</summary>
                    <pre className="mt-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 p-2 rounded max-h-32 overflow-auto">
                      {result.domPreview.slice(0, 800)}
                    </pre>
                  </details>
                )}
                {result.screenshotPath && (
                  <div className="text-xs text-blue-500 mt-1">Screenshot: {result.screenshotPath}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
