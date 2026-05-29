import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

// ── Backups Tab ──
interface BackupItem {
  path: string;
  size: number;
  createdAt?: string;
}

export function BackupsTab() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const fetchBackups = () => {
    apiFetch('/api/backups', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBackups(d.backups ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreate = async () => {
    setStatus('Creating backup...');
    try {
      const r = await apiFetch('/api/backups', {
        method: 'POST',
        headers: authHeaders(),
      });
      const d = await r.json();
      setStatus(d.path ? `Backup created: ${d.path}` : 'Backup failed');
      fetchBackups();
    } catch {
      setStatus('Backup failed');
    }
  };

  const handleRestore = async (path: string) => {
    if (!confirm(`Restore database from ${path}? This will overwrite current data.`)) return;
    setRestoring(true);
    try {
      await apiFetch('/api/backups/restore', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ path }),
      });
      setStatus('Database restored. Some changes may require a restart.');
    } catch {
      setStatus('Restore failed');
    }
    setRestoring(false);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-content-primary">Backups</h2>
        <button
          onClick={handleCreate}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-content-inverse hover:bg-accent-hover"
        >
          + Create Backup
        </button>
      </div>

      {status && (
        <div
          className={`mb-3 rounded px-3 py-2 text-sm ${status.includes('fail') || status.includes('Failed') ? 'bg-intent-danger-muted text-intent-danger' : 'bg-intent-success-muted text-intent-success'}`}
        >
          {status}
        </div>
      )}

      {backups.length === 0 ? (
        <p className="py-4 text-sm text-content-tertiary">
          No backups yet. Create your first backup to protect your data.
        </p>
      ) : (
        <div className="space-y-2">
          {backups.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border bg-surface-primary p-3"
            >
              <div>
                <div className="font-mono text-sm font-medium text-content-primary">
                  {b.path}
                </div>
                <div className="text-xs text-content-tertiary">
                  {formatSize(b.size)}
                  {b.createdAt && ` · ${new Date(b.createdAt).toLocaleString()}`}
                </div>
              </div>
              <button
                onClick={() => handleRestore(b.path)}
                disabled={restoring}
                className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-600 hover:text-amber-700 disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
