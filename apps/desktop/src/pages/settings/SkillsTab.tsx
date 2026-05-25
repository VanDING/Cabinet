import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

// ── Skills Tab ──
interface SkillItem {
  id: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  status: string;
}

export function SkillsTab() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    kind: 'tool',
    promptTemplate: '',
  });

  const fetchSkills = () => {
    apiFetch('/api/skills', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    const handler = () => fetchSkills();
    window.addEventListener('ws:skill_created', handler);
    window.addEventListener('ws:skill_updated', handler);
    window.addEventListener('ws:skill_deleted', handler);
    return () => {
      window.removeEventListener('ws:skill_created', handler);
      window.removeEventListener('ws:skill_updated', handler);
      window.removeEventListener('ws:skill_deleted', handler);
    };
  }, []);

  const handleCreate = async () => {
    if (editingId) {
      await apiFetch(`/api/skills/${editingId}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
      setEditingId(null);
    } else {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
    }
    setShowForm(false);
    setFormData({ name: '', description: '', kind: 'tool', promptTemplate: '' });
    fetchSkills();
  };

  const handleEdit = (s: SkillItem) => {
    setEditingId(s.id);
    setFormData({ name: s.name, description: s.description, kind: s.kind, promptTemplate: '' });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/skills/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    fetchSkills();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Skills</h2>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.md,.zip';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  if (file.name.endsWith('.zip')) {
                    // Send zip directly to server for full extraction (L3)
                    const formData = new FormData();
                    formData.append('file', file);
                    const res = await fetch('/api/skills/import-zip', {
                      method: 'POST',
                      body: formData,
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({ error: 'Import failed' }));
                      alert(`Import failed: ${(err as any).error ?? res.statusText}`);
                      return;
                    }
                  } else {
                    const content = await file.text();
                    const res = await apiFetch('/api/skills/import', {
                      method: 'POST',
                      headers: authJsonHeaders(),
                      body: JSON.stringify({ content }),
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({ error: 'Import failed' }));
                      alert(`Import failed: ${(err as any).error ?? res.statusText}`);
                      return;
                    }
                  }
                  fetchSkills();
                } catch {
                  alert('Failed to import skill. Check file format and try again.');
                }
              };
              input.click();
            }}
            className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Import
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ New Skill'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="space-y-3">
            <input
              placeholder="Name"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <textarea
              placeholder="Description"
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              rows={2}
              className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="flex gap-3">
              <select
                value={formData.kind}
                onChange={(e) => setFormData((p) => ({ ...p, kind: e.target.value }))}
                className="rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="tool">Tool</option>
                <option value="prompt">Prompt</option>
                <option value="composite">Composite</option>
              </select>
              <input
                placeholder="Prompt Template"
                value={formData.promptTemplate}
                onChange={(e) => setFormData((p) => ({ ...p, promptTemplate: e.target.value }))}
                className="flex-1 rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!formData.name.trim()}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editingId ? 'Save Changes' : 'Register Skill'}
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">No skills registered yet.</p>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => (
            <div
              key={s.id}
              className="group flex items-center justify-between rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {s.name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${s.kind === 'tool' ? 'bg-blue-100 text-blue-700' : s.kind === 'prompt' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}
                  >
                    {s.kind}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(s)}
                  className="px-2 py-1 text-xs text-gray-400 opacity-0 transition-opacity hover:text-blue-500 group-hover:opacity-100"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="px-2 py-1 text-xs text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                >
                  Del
                </button>
                <span className="text-xs text-gray-400">v{s.version}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
