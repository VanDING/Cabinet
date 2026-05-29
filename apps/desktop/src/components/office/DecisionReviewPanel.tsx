import { useState, useEffect } from 'react';
import type { Decision, DecisionOption } from '@cabinet/types';
import { useToast } from '../Toast';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

interface AuditEntry {
  action: string;
  actor: string;
  changes: Record<string, unknown>;
  timestamp: string;
}

interface Props {
  decisionId: string;
  onClose: () => void;
  onResolved: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  L0: 'bg-intent-success-muted text-intent-success',
  L1: 'bg-accent-muted text-accent',
  L2: 'bg-amber-100 text-amber-700',
  L3: 'bg-intent-danger-muted text-intent-danger',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-50',
  approved: 'text-intent-success bg-intent-success-muted',
  rejected: 'text-intent-danger bg-intent-danger-muted',
  expired: 'text-content-tertiary bg-surface-muted',
  archived: 'text-content-tertiary bg-surface-muted',
};

const TYPE_LABELS: Record<string, string> = {
  strategic: 'Strategic',
  action: 'Action',
  execution: 'Execution',
  anomaly: 'Anomaly',
  evolution: 'Evolution',
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  L0: 'Auto-approved — low risk, reversible, minimal cost',
  L1: 'Auto-approved — within session, few options, low cost',
  L2: 'Requires review — cross-session impact, multiple options, moderate cost',
  L3: 'Escalated — involves funds, permissions, data, or high cost',
};

export function DecisionReviewPanel({ decisionId, onClose, onResolved }: Props) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/decisions/${decisionId}`, { headers: authHeaders() }).then((r) => r.json()),
      apiFetch(`/api/decisions/${decisionId}/audit`, { headers: authHeaders() }).then((r) =>
        r.json(),
      ),
    ])
      .then(([decisionData, auditData]) => {
        if (decisionData.decision) {
          setDecision(decisionData.decision);
          if (decisionData.decision.chosenOptionId) {
            setSelectedOption(decisionData.decision.chosenOptionId);
          }
        }
        if (auditData.trail) setAudit(auditData.trail);
      })
      .catch(() => addToast('error', 'Failed to load decision'))
      .finally(() => setLoading(false));
  }, [decisionId, addToast]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleApprove = async () => {
    if (!selectedOption) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/decisions/${decisionId}/approve`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ chosenOptionId: selectedOption, reason }),
      });
      addToast('success', 'Decision approved');
      onResolved();
      onClose();
    } catch {
      addToast('error', 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/decisions/${decisionId}/reject`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ reason }),
      });
      addToast('info', 'Decision rejected');
      onResolved();
      onClose();
    } catch {
      addToast('error', 'Failed to reject');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl items-center justify-center border-l border-border bg-surface-primary shadow-2xl">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl items-center justify-center border-l border-border bg-surface-primary shadow-2xl">
        <p className="text-sm text-content-tertiary">Decision not found</p>
      </div>
    );
  }

  const dimensionLabels = ['Risk', 'Cost', 'Time', 'Reversibility', 'Strategic Fit'];
  const dimIcons = ['⚠', '\u{1F4B5}', '⏱', '\u{1F504}', '\u{1F3AF}'];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-border bg-surface-primary shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-surface-primary px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold ${LEVEL_COLORS[decision.level] ?? ''}`}
                >
                  {decision.level}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[decision.status] ?? ''}`}
                >
                  {decision.status}
                </span>
                <span className="text-xs text-content-tertiary">
                  {TYPE_LABELS[decision.type] ?? decision.type}
                </span>
              </div>
              <h2 className="truncate text-lg font-bold text-content-primary">
                {decision.title}
              </h2>
              <p className="mt-1 text-xs text-content-tertiary">{LEVEL_DESCRIPTIONS[decision.level]}</p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 text-xl leading-none text-content-tertiary hover:text-content-secondary:text-content-tertiary"
            >
              &times;
            </button>
          </div>

          {/* Description */}
          {decision.description && (
            <p className="mt-3 text-sm text-content-secondary">{decision.description}</p>
          )}
        </div>

        {/* Body */}
        <div className="space-y-6 px-6 py-4">
          {/* Option Comparison */}
          {decision.options && decision.options.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-content-primary">
                Options
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {decision.options.map((opt: DecisionOption) => {
                  const isSelected = selectedOption === opt.id;
                  const isResolved = decision.status !== 'pending';

                  return (
                    <button
                      key={opt.id}
                      onClick={() => !isResolved && setSelectedOption(opt.id)}
                      disabled={isResolved}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isResolved && decision.chosenOptionId === opt.id
                          ? 'border-intent-success bg-intent-success-muted ring-2 ring-intent-success'
                          : isSelected
                            ? 'border-accent bg-accent-muted ring-2 ring-accent'
                            : 'border-border hover:border-accent:border-accent'
                      } ${isResolved ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <div
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                            isResolved && decision.chosenOptionId === opt.id
                              ? 'border-intent-success bg-intent-success'
                              : isSelected
                                ? 'border-accent bg-accent'
                                : 'border-border'
                          }`}
                        >
                          {((isResolved && decision.chosenOptionId === opt.id) || isSelected) && (
                            <div className="h-1.5 w-1.5 rounded-full bg-surface-primary" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-content-primary">
                          {opt.label}
                        </span>
                        {isResolved && decision.chosenOptionId === opt.id && (
                          <span className="ml-auto text-xs font-medium text-intent-success">Chosen</span>
                        )}
                      </div>

                      <p className="mt-1.5 text-xs text-content-tertiary">
                        {opt.impact}
                      </p>

                      {/* Dimension bars (simulated for visual comparison) */}
                      <div className="mt-2 space-y-1">
                        {dimensionLabels.map((dim, idx) => {
                          const hash = (opt.id + dim)
                            .split('')
                            .reduce((a, c) => a + c.charCodeAt(0), 0);
                          const value = (hash % 60) + 20; // 20-80 range
                          const isHigh = value > 60;
                          return (
                            <div key={dim} className="flex items-center gap-2">
                              <span className="w-5 text-xs text-content-tertiary">{dimIcons[idx]}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                                <div
                                  className={`h-full rounded-full ${isHigh ? 'bg-amber-400' : 'bg-accent'}`}
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Audit Trail */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-content-primary">
              Decision Trail
            </h3>
            {audit.length === 0 ? (
              <p className="text-xs text-content-tertiary">No audit entries yet.</p>
            ) : (
              <div className="space-y-0">
                {audit.map((entry, i) => (
                  <div key={i} className="relative flex gap-3 pb-3 text-xs">
                    {/* Timeline line */}
                    {i < audit.length - 1 && (
                      <div className="absolute bottom-0 left-[6.5px] top-3 w-px bg-surface-muted" />
                    )}
                    {/* Dot */}
                    <div
                      className={`mt-0.5 h-3 w-3 flex-shrink-0 rounded-full ${
                        entry.action === 'created'
                          ? 'bg-accent'
                          : entry.action === 'approved'
                            ? 'bg-intent-success'
                            : entry.action === 'rejected'
                              ? 'bg-intent-danger'
                              : 'bg-surface-muted'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize text-content-secondary">
                          {entry.action}
                        </span>
                        <span className="text-content-tertiary">by {entry.actor}</span>
                        <span className="ml-auto flex-shrink-0 text-content-tertiary">
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <div className="mt-0.5 text-content-tertiary">
                          {Object.entries(entry.changes).map(([k, v]) => (
                            <span key={k} className="mr-2">
                              {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Meta */}
          <section className="space-y-1 text-xs text-content-tertiary">
            <div className="flex justify-between">
              <span>Created</span>
              <span>{new Date(decision.createdAt).toLocaleString()}</span>
            </div>
            {decision.resolvedAt && (
              <div className="flex justify-between">
                <span>Resolved</span>
                <span>{new Date(decision.resolvedAt).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Project</span>
              <span className="font-mono">{decision.projectId}</span>
            </div>
          </section>
        </div>

        {/* Footer — Captain Actions (only for pending decisions) */}
        {decision.status === 'pending' && (
          <div className="sticky bottom-0 space-y-3 border-t border-border bg-surface-primary px-6 py-4">
            {/* Reason (optional) */}
            <textarea
              placeholder="Reasoning (optional)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full resize-none rounded border bg-surface-elevated px-3 py-2 text-sm text-content-primary"
            />

            {/* Action buttons */}
            <div className="flex gap-2">
              {decision.options && decision.options.length > 0 && (
                <select
                  value={selectedOption ?? ''}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="flex-1 rounded border bg-surface-primary px-3 py-2 text-sm text-content-primary"
                >
                  <option value="" disabled>
                    Select an option...
                  </option>
                  {decision.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={handleApprove}
                disabled={submitting || !selectedOption}
                className="rounded-lg bg-intent-success px-4 py-2 text-sm text-content-inverse transition-colors hover:bg-intent-success disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '...' : 'Approve'}
              </button>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="rounded-lg bg-intent-danger px-4 py-2 text-sm text-content-inverse transition-colors hover:bg-intent-danger disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '...' : 'Reject'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
