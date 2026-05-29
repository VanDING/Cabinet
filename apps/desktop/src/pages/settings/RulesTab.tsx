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
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : mode === 'auto'
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Project Rules</h2>
      <p className="mb-4 text-xs text-gray-500">
        Rules are loaded from{' '}
        <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">.cabinet/rules/</code>. Each
        file has YAML frontmatter controlling when it activates.
      </p>

      {status && (
        <div
          className={`mb-3 rounded px-3 py-2 text-sm ${status.includes('fail') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
        >
          {status}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">
          No rules found. Create .md files in .cabinet/rules/ to define project conventions.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.filename}
              className="overflow-hidden rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-center justify-between p-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                      {rule.filename}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${modeColor(rule.mode)}`}
                    >
                      {rule.mode}
                    </span>
                    {rule.alwaysApply && (
                      <span className="text-xs text-green-600">alwaysApply</span>
                    )}
                  </div>
                  {rule.description && <p className="text-xs text-gray-500">{rule.description}</p>}
                  <div className="mt-1 flex gap-2">
                    {rule.globs.map((g) => (
                      <span
                        key={g}
                        className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                      >
                        {g}
                      </span>
                    ))}
                    {rule.tags.map((t) => (
                      <span key={t} className="text-xs text-blue-500">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() =>
                    editingFile === rule.filename ? setEditingFile(null) : handleEdit(rule)
                  }
                  className="ml-3 flex-shrink-0 text-xs text-blue-500 hover:underline"
                >
                  {editingFile === rule.filename ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {editingFile === rule.filename && (
                <div className="border-t bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={12}
                    className="w-full rounded border bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
