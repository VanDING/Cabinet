import { useState, useEffect } from 'react';
import { Button } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

// ── Rules Tab ──
interface RuleItem {
  filename: string;
  path: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
  tags: string[];
  content: string;
  mode: string;
}

export function RulesTab() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const fetchRules = () => {
    apiFetch('/api/rules', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleEdit = (rule: RuleItem) => {
    setEditingFile(rule.filename);
    setEditContent(rule.content);
    setStatus(null);
  };

  const handleSave = async (filename: string) => {
    try {
      await apiFetch(`/api/rules/${filename}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ content: editContent }),
      });
      setStatus(`Saved ${filename}`);
      setEditingFile(null);
      fetchRules();
    } catch {
      setStatus('Save failed');
    }
  };

  const modeColor = (mode: string) =>
    mode === 'always'
      ? 'bg-intent-success-muted text-intent-success'
      : mode === 'auto'
        ? 'bg-accent-muted text-accent'
        : 'bg-surface-muted text-content-secondary';

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-content-primary">Project Rules</h2>
      <p className="mb-4 text-xs text-content-tertiary">
        Rules are loaded from{' '}
        <code className="rounded bg-surface-muted px-1">.cabinet/rules/</code>. Each
        file has YAML frontmatter controlling when it activates.
      </p>

      {status && (
        <div
          className={`mb-3 rounded px-3 py-2 text-sm ${status.includes('fail') ? 'bg-intent-danger-muted text-intent-danger' : 'bg-intent-success-muted text-intent-success'}`}
        >
          {status}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="py-4 text-sm text-content-tertiary">
          No rules found. Create .md files in .cabinet/rules/ to define project conventions.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.filename}
              className="overflow-hidden rounded-lg border border-border bg-surface-primary shadow-sm"
            >
              <div className="flex items-center justify-between p-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-content-primary">
                      {rule.filename}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${modeColor(rule.mode)}`}
                    >
                      {rule.mode}
                    </span>
                    {rule.alwaysApply && (
                      <span className="text-xs text-intent-success">alwaysApply</span>
                    )}
                  </div>
                  {rule.description && <p className="text-xs text-content-tertiary">{rule.description}</p>}
                  <div className="mt-1 flex gap-2">
                    {rule.globs.map((g) => (
                      <span
                        key={g}
                        className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-content-secondary"
                      >
                        {g}
                      </span>
                    ))}
                    {rule.tags.map((t) => (
                      <span key={t} className="text-xs text-accent">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() =>
                    editingFile === rule.filename ? setEditingFile(null) : handleEdit(rule)
                  }
                  className="ml-3 flex-shrink-0 text-xs text-accent hover:underline"
                >
                  {editingFile === rule.filename ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {editingFile === rule.filename && (
                <div className="border-t border-border bg-surface-elevated p-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={12}
                    className="w-full rounded border border-border bg-surface-primary px-3 py-2 font-mono text-sm text-content-primary"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={() => handleSave(rule.filename)}>
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
