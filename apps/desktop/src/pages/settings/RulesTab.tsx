import { useState, useEffect } from 'react';

import { Button, Tag } from '@cabinet/ui';

import { ModalOverlay } from '../../components/ModalOverlay';

import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';

import { toast } from 'sonner';// ── Types ──
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

type RuleMode = 'always' | 'auto' | 'on-demand';

interface RuleForm {
  filename: string;
  mode: RuleMode;
  description: string;
  globs: string[];
  tags: string[];
  content: string;
}

const emptyForm: RuleForm = {
  filename: '',
  mode: 'always',
  description: '',
  globs: [],
  tags: [],
  content: '',
};

// ── Helpers ──
const modeLabel: Record<RuleMode, string> = {
  always: 'Always',
  auto: 'Auto',
  'on-demand': 'On Demand',
};

const modeColor = (mode: string) => {
  switch (mode) {
    case 'always':
      return 'bg-intent-success-muted text-intent-success';
    case 'auto':
      return 'bg-accent-muted text-accent';
    default:
      return 'bg-surface-muted text-content-secondary';
  }
};

// ── Tag Input ──
function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) {
      onChange([...values, v]);
    }
    setInput('');
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        {values.map((v) => (
          <span
            key={v}
            className="bg-surface-muted text-content-secondary inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs"
          >
            {v}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-content-tertiary hover:text-intent-danger"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={placeholder || 'Type and press Enter'}
        className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
      />
    </div>
  );
}

// ── Rule Modal ──
function RuleModal({
  isOpen,
  isNew,
  form,
  onChange,
  onSave,
  onDelete,
  onClose,
}: {
  isOpen: boolean;
  isNew: boolean;
  form: RuleForm;
  onChange: (f: RuleForm) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  const update = (patch: Partial<RuleForm>) => {
    onChange({ ...form, ...patch });
  };

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      contentClassName="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface-overlay p-6 shadow-2xl"
    >
      <h3 className="text-content-primary mb-5 text-lg font-semibold">
        {isNew ? 'New Rule' : 'Edit Rule'}
      </h3>

      <div className="space-y-4">
        {/* Mode */}
        <div>
          <label className="text-content-secondary mb-1 block text-xs font-medium">
            Mode <span className="text-intent-danger">*</span>
          </label>
          <select
            value={form.mode}
            onChange={(e) => update({ mode: e.target.value as RuleMode })}
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
          >
            <option value="always">Always — loaded every session</option>
            <option value="auto">Auto — loaded when files match globs</option>
            <option value="on-demand">On Demand — loaded when agent requests</option>
          </select>
          <p className="text-content-tertiary mt-1 text-xs">
            {form.mode === 'always' && 'Rule is always active for every session.'}
            {form.mode === 'auto' && 'Rule activates when active files match the globs below.'}
            {form.mode === 'on-demand' &&
              'Rule is only loaded when the agent explicitly requests it.'}
          </p>
        </div>

        {/* Filename */}
        <div>
          <label className="text-content-secondary mb-1 block text-xs font-medium">
            Filename <span className="text-intent-danger">*</span>
          </label>
          <input
            type="text"
            value={form.filename}
            onChange={(e) => update({ filename: e.target.value })}
            disabled={!isNew}
            placeholder="e.g. react-conventions.md"
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-content-secondary mb-1 block text-xs font-medium">
            Description
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Short description of this rule"
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
          />
        </div>

        {/* Globs — only for auto mode */}
        {form.mode === 'auto' && (
          <div>
            <label className="text-content-secondary mb-1 block text-xs font-medium">
              Globs <span className="text-intent-danger">*</span>
            </label>
            <TagInput
              values={form.globs}
              onChange={(globs) => update({ globs })}
              placeholder="e.g. src/**/*.tsx"
            />
          </div>
        )}

        {/* Tags */}
        <div>
          <label className="text-content-secondary mb-1 block text-xs font-medium">Tags</label>
          <TagInput
            values={form.tags}
            onChange={(tags) => update({ tags })}
            placeholder="e.g. frontend"
          />
        </div>

        {/* Content */}
        <div>
          <label className="text-content-secondary mb-1 block text-xs font-medium">Content</label>
          <textarea
            value={form.content}
            onChange={(e) => update({ content: e.target.value })}
            rows={6}
            placeholder="# Rule content in Markdown..."
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 font-mono text-sm"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center justify-between">
        {!isNew && (
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Delete
          </Button>
        )}
        {isNew && <div />}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Rules Tab ──
export function RulesTab() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [status, setStatus] = useState<string | null>(null);

  const fetchRules = () => {
    apiFetch('/api/rules', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const openNew = () => {
    setIsNew(true);
    setForm({ ...emptyForm, filename: '', mode: 'always' });
    setModalOpen(true);
    setStatus(null);
  };

  const openEdit = (rule: RuleItem) => {
    setIsNew(false);
    setForm({
      filename: rule.filename,
      mode: rule.mode as RuleMode,
      description: rule.description,
      globs: rule.globs,
      tags: rule.tags,
      content: rule.content,
    });
    setModalOpen(true);
    setStatus(null);
  };

  const handleSave = async () => {
    if (!form.filename.trim()) {
      setStatus('Filename is required');
      return;
    }
    if (form.mode === 'auto' && form.globs.length === 0) {
      setStatus('At least one glob is required for auto mode');
      return;
    }

    try {
      if (isNew) {
        await apiFetch('/api/rules', {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify(form),
        });
        toast.success(`Created ${form.filename}`);
      } else {
        await apiFetch(`/api/rules/${form.filename}`, {
          method: 'PUT',
          headers: authJsonHeaders(),
          body: JSON.stringify(form),
        });
        toast.success(`Updated ${form.filename}`);
      }
      setModalOpen(false);
      fetchRules();
    } catch {
      setStatus('Save failed');
      toast.error('Failed to save rule');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete rule "${form.filename}"?`)) return;
    try {
      await apiFetch(`/api/rules/${form.filename}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setModalOpen(false);
      fetchRules();
      toast.success(`Deleted ${form.filename}`);
    } catch {
      toast.error('Failed to delete rule');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-end">
        <Button size="sm" onClick={openNew}>
          + New Rule
        </Button>
      </div>

      {status && (
        <div
          className={`mb-3 rounded px-3 py-2 text-sm ${status.includes('fail') || status.includes('required') ? 'bg-intent-danger-muted text-intent-danger' : 'bg-intent-success-muted text-intent-success'}`}
        >
          {status}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-content-tertiary py-4 text-sm">No rules found.</p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.filename}
              className="border-border bg-surface-primary overflow-hidden rounded-lg border shadow-xs"
            >
              <div className="flex items-center justify-between p-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-content-primary font-mono text-sm font-medium">
                      {rule.filename}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${modeColor(rule.mode)}`}
                    >
                      {modeLabel[rule.mode as RuleMode]}
                    </span>
                    {rule.alwaysApply && (
                      <span className="text-intent-success text-xs">alwaysApply</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-content-tertiary text-xs">{rule.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {rule.globs.map((g) => (
                      <span
                        key={g}
                        className="bg-surface-muted text-content-secondary rounded-sm px-1.5 py-0.5 font-mono text-xs"
                      >
                        {g}
                      </span>
                    ))}
                    {rule.tags.map((t) => (
                      <span key={t} className="text-accent text-xs">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => openEdit(rule)}
                  className="text-accent ml-3 shrink-0 text-xs hover:underline"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <RuleModal
        isOpen={modalOpen}
        isNew={isNew}
        form={form}
        onChange={setForm}
        onSave={handleSave}
        onDelete={handleDelete}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
