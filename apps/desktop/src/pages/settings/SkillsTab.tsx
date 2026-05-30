import { useState, useEffect } from 'react';
import { Button, Input, Card, Tag } from '@cabinet/ui';
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
        <h2 className="text-lg font-semibold text-content-primary">Skills</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
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
          >
            Import
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ New Skill'}
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border border-border bg-surface-elevated p-4">
          <div className="space-y-3">
            <input
              placeholder="Name"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            />
            <textarea
              placeholder="Description"
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              rows={2}
              className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            />
            <div className="flex gap-3">
              <select
                value={formData.kind}
                onChange={(e) => setFormData((p) => ({ ...p, kind: e.target.value }))}
                className="rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              >
                <option value="tool">Tool</option>
                <option value="prompt">Prompt</option>
                <option value="composite">Composite</option>
              </select>
              <input
                placeholder="Prompt Template"
                value={formData.promptTemplate}
                onChange={(e) => setFormData((p) => ({ ...p, promptTemplate: e.target.value }))}
                className="flex-1 rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <Button
              size="sm"
              fullWidth
              onClick={handleCreate}
              disabled={!formData.name.trim()}
            >
              {editingId ? 'Save Changes' : 'Register Skill'}
            </Button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <p className="py-4 text-sm text-content-tertiary">No skills registered yet.</p>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => (
            <Card key={s.id} padding="sm" className="group flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content-primary">
                    {s.name}
                  </span>
                  <Tag
                    variant={s.kind === 'tool' ? 'info' : s.kind === 'prompt' ? 'success' : 'purple'}
                  >
                    {s.kind}
                  </Tag>
                  <Tag variant={s.status === 'active' ? 'success' : 'warning'}>
                    {s.status}
                  </Tag>
                </div>
                <p className="mt-0.5 text-xs text-content-tertiary">{s.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(s)}
                  className="px-2 py-1 text-xs text-content-tertiary opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="px-2 py-1 text-xs text-content-tertiary opacity-0 transition-opacity hover:text-intent-danger group-hover:opacity-100"
                >
                  Del
                </button>
                <span className="text-xs text-content-tertiary">v{s.version}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
