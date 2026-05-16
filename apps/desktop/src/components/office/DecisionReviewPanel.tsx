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
  L0: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  L1: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  L2: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  L3: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
  approved: 'text-green-600 bg-green-50 dark:bg-green-900/20',
  rejected: 'text-red-600 bg-red-50 dark:bg-red-900/20',
  expired: 'text-gray-400 bg-gray-100 dark:bg-gray-800',
  archived: 'text-gray-400 bg-gray-100 dark:bg-gray-800',
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
      apiFetch(`/api/decisions/${decisionId}`, { headers: authHeaders() }).then(r => r.json()),
      apiFetch(`/api/decisions/${decisionId}/audit`, { headers: authHeaders() }).then(r => r.json()),
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
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white dark:bg-gray-800 shadow-2xl border-l dark:border-gray-700 z-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white dark:bg-gray-800 shadow-2xl border-l dark:border-gray-700 z-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Decision not found</p>
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
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white dark:bg-gray-800 shadow-2xl border-l dark:border-gray-700 z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${LEVEL_COLORS[decision.level] ?? ''}`}>
                  {decision.level}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[decision.status] ?? ''}`}>
                  {decision.status}
                </span>
                <span className="text-xs text-gray-400">{TYPE_LABELS[decision.type] ?? decision.type}</span>
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{decision.title}</h2>
              <p className="text-xs text-gray-500 mt-1">{LEVEL_DESCRIPTIONS[decision.level]}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none flex-shrink-0">&times;</button>
          </div>

          {/* Description */}
          {decision.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">{decision.description}</p>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          {/* Option Comparison */}
          {decision.options && decision.options.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Options</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {decision.options.map((opt: DecisionOption) => {
                  const isSelected = selectedOption === opt.id;
                  const isResolved = decision.status !== 'pending';

                  return (
                    <button
                      key={opt.id}
                      onClick={() => !isResolved && setSelectedOption(opt.id)}
                      disabled={isResolved}
                      className={`text-left border rounded-lg p-3 transition-all ${
                        isResolved && decision.chosenOptionId === opt.id
                          ? 'ring-2 ring-green-500 border-green-500 bg-green-50 dark:bg-green-900/20'
                          : isSelected
                          ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                      } ${isResolved ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          isResolved && decision.chosenOptionId === opt.id
                            ? 'border-green-500 bg-green-500'
                            : isSelected
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {((isResolved && decision.chosenOptionId === opt.id) || isSelected) && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{opt.label}</span>
                        {isResolved && decision.chosenOptionId === opt.id && (
                          <span className="text-xs text-green-600 font-medium ml-auto">Chosen</span>
                        )}
                      </div>

                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{opt.impact}</p>

                      {/* Dimension bars (simulated for visual comparison) */}
                      <div className="mt-2 space-y-1">
                        {dimensionLabels.map((dim, idx) => {
                          const hash = (opt.id + dim).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                          const value = (hash % 60) + 20; // 20-80 range
                          const isHigh = value > 60;
                          return (
                            <div key={dim} className="flex items-center gap-2">
                              <span className="text-xs w-5 text-gray-400">{dimIcons[idx]}</span>
                              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${isHigh ? 'bg-amber-400' : 'bg-blue-400'}`}
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
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Decision Trail</h3>
            {audit.length === 0 ? (
              <p className="text-xs text-gray-400">No audit entries yet.</p>
            ) : (
              <div className="space-y-0">
                {audit.map((entry, i) => (
                  <div key={i} className="flex gap-3 text-xs pb-3 relative">
                    {/* Timeline line */}
                    {i < audit.length - 1 && (
                      <div className="absolute left-[6.5px] top-3 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
                    )}
                    {/* Dot */}
                    <div className={`w-3 h-3 rounded-full mt-0.5 flex-shrink-0 ${
                      entry.action === 'created' ? 'bg-blue-400' :
                      entry.action === 'approved' ? 'bg-green-400' :
                      entry.action === 'rejected' ? 'bg-red-400' :
                      'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-700 dark:text-gray-300 capitalize">{entry.action}</span>
                        <span className="text-gray-400">by {entry.actor}</span>
                        <span className="text-gray-400 ml-auto flex-shrink-0">
                          {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <div className="text-gray-400 mt-0.5">
                          {Object.entries(entry.changes).map(([k, v]) => (
                            <span key={k} className="mr-2">{k}: {typeof v === 'string' ? v : JSON.stringify(v)}</span>
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
          <section className="text-xs text-gray-400 space-y-1">
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
          <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t dark:border-gray-700 px-6 py-4 space-y-3">
            {/* Reason (optional) */}
            <textarea
              placeholder="Reasoning (optional)..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-none"
            />

            {/* Action buttons */}
            <div className="flex gap-2">
              {decision.options && decision.options.length > 0 && (
                <select
                  value={selectedOption ?? ''}
                  onChange={e => setSelectedOption(e.target.value)}
                  className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="" disabled>Select an option...</option>
                  {decision.options.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              )}
              <button
                onClick={handleApprove}
                disabled={submitting || !selectedOption}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? '...' : 'Approve'}
              </button>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
