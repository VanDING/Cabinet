import { useState, useEffect } from 'react';

import type { Decision, DecisionOption } from '@cabinet/types';

import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';


import { toast } from 'sonner';interface AuditEntry {
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
  L2: 'bg-intent-warning-muted text-intent-warning',
  L3: 'bg-intent-danger-muted text-intent-danger',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-intent-warning bg-intent-warning-muted',
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
  // ── Comments (M4 discussion threads) ──
  const [comments, setComments] = useState<
    Array<{
      id: string;
      author_name: string;
      content: string;
      created_at: string;
      replies: Array<{ id: string; author_name: string; content: string; created_at: string }>;
    }>
  >([]);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/decisions/${decisionId}`, { headers: authHeaders() }).then((r) => r.json()),
      apiFetch(`/api/decisions/${decisionId}/audit`, { headers: authHeaders() }).then((r) =>
        r.json(),
      ),
      apiFetch(`/api/decisions/${decisionId}/comments`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => setComments(d.comments ?? []))
        .catch(() => {}),
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
      .catch(() => toast.error('Failed to load decision'))
      .finally(() => setLoading(false));
  }, [decisionId]);

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
      toast.success('Decision approved');
      onResolved();
      onClose();
    } catch {
      toast.error('Failed to approve');
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
      toast('Decision rejected');
      onResolved();
      onClose();
    } catch {
      toast.error('Failed to reject');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Comment handlers (M4) ──
  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await apiFetch(`/api/decisions/${decisionId}/comments`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ content: commentText }),
      });
      const data = await res.json();
      setComments((prev) => [
        ...prev,
        {
          id: data.id,
          author_name: 'You',
          content: commentText,
          created_at: data.createdAt,
          replies: [],
        },
      ]);
      setCommentText('');
      toast('Comment added');
    } catch {
      toast.error('Failed to add comment');
    }
  };

  const handleAddReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    try {
      const res = await apiFetch(`/api/decisions/${decisionId}/comments`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ content: replyText, parentCommentId: parentId }),
      });
      const data = await res.json();
      setComments((prev) =>
        prev.map((c) =>
          c.id === parentId
            ? {
                ...c,
                replies: [
                  ...c.replies,
                  {
                    id: data.id,
                    author_name: 'You',
                    content: replyText,
                    created_at: data.createdAt,
                  },
                ],
              }
            : c,
        ),
      );
      setReplyText('');
      setReplyTo(null);
      toast('Reply added');
    } catch {
      toast.error('Failed to add reply');
    }
  };

  const dimensionLabels = ['Risk', 'Cost', 'Time', 'Reversibility', 'Strategic Fit'];
  const dimIcons = ['⚠', '\u{1F4B5}', '⏱', '\u{1F504}', '\u{1F3AF}'];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="decision-panel-enter border-border bg-surface-primary fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l shadow-2xl">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : !decision ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-content-tertiary text-sm">Decision not found</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-border bg-surface-primary sticky top-0 z-10 border-b px-6 py-4">
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
                    <span className="text-content-tertiary text-xs">
                      {TYPE_LABELS[decision.type] ?? decision.type}
                    </span>
                  </div>
                  <h2 className="text-content-primary truncate text-lg font-bold">
                    {decision.title}
                  </h2>
                  <p className="text-content-tertiary mt-1 text-xs">
                    {LEVEL_DESCRIPTIONS[decision.level]}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="text-content-tertiary hover:text-content-secondary shrink-0 text-xl leading-none"
                >
                  &times;
                </button>
              </div>

              {/* Description */}
              {decision.description && (
                <p className="text-content-secondary mt-3 text-sm">{decision.description}</p>
              )}
            </div>

            {/* Body */}
            <div className="space-y-6 px-6 py-4">
              {/* Option Comparison */}
              {decision.options && decision.options.length > 0 && (
                <section>
                  <h3 className="text-content-primary mb-3 text-sm font-semibold">Options</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {decision.options.map((opt: DecisionOption) => {
                      const isSelected = selectedOption === opt.id;
                      const isResolved = decision.status !== 'pending';

                      return (
                        <button
                          key={opt.id}
                          onClick={() => !isResolved && setSelectedOption(opt.id)}
                          disabled={isResolved}
                          className={`border-border rounded-lg border p-3 text-left transition-all ${
                            isResolved && decision.chosenOptionId === opt.id
                              ? 'border-intent-success bg-intent-success-muted ring-intent-success ring-2'
                              : isSelected
                                ? 'border-accent bg-accent-muted ring-accent ring-2'
                                : 'border-border hover:border-accent'
                          } ${isResolved ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <div
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                                isResolved && decision.chosenOptionId === opt.id
                                  ? 'border-intent-success bg-intent-success'
                                  : isSelected
                                    ? 'border-accent bg-accent'
                                    : 'border-border'
                              }`}
                            >
                              {((isResolved && decision.chosenOptionId === opt.id) ||
                                isSelected) && (
                                <div className="bg-surface-primary h-1.5 w-1.5 rounded-full" />
                              )}
                            </div>
                            <span className="text-content-primary text-sm font-medium">
                              {opt.label}
                            </span>
                            {isResolved && decision.chosenOptionId === opt.id && (
                              <span className="text-intent-success ml-auto text-xs font-medium">
                                Chosen
                              </span>
                            )}
                          </div>

                          <p className="text-content-tertiary mt-1.5 text-xs">{opt.impact}</p>

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
                                  <span className="text-content-tertiary w-5 text-xs">
                                    {dimIcons[idx]}
                                  </span>
                                  <div className="bg-surface-muted h-1.5 flex-1 overflow-hidden rounded-full">
                                    <div
                                      className={`h-full rounded-full ${isHigh ? 'bg-intent-warning' : 'bg-accent'}`}
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
                <h3 className="text-content-primary mb-3 text-sm font-semibold">Decision Trail</h3>
                {audit.length === 0 ? (
                  <p className="text-content-tertiary text-xs">No audit entries yet.</p>
                ) : (
                  <div className="space-y-0">
                    {audit.map((entry, i) => (
                      <div key={i} className="relative flex gap-3 pb-3 text-xs">
                        {/* Timeline line */}
                        {i < audit.length - 1 && (
                          <div className="bg-surface-muted absolute top-3 bottom-0 left-[6.5px] w-px" />
                        )}
                        {/* Dot */}
                        <div
                          className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${
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
                            <span className="text-content-secondary font-medium capitalize">
                              {entry.action}
                            </span>
                            <span className="text-content-tertiary">by {entry.actor}</span>
                            <span className="text-content-tertiary ml-auto shrink-0">
                              {new Date(entry.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {entry.changes && Object.keys(entry.changes).length > 0 && (
                            <div className="text-content-tertiary mt-0.5">
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
              <section className="text-content-tertiary space-y-1 text-xs">
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
            {/* ── Discussion Thread (M4) ── */}
            <div className="border-border border-t px-6 py-4">
              <h3 className="text-content-primary mb-3 text-sm font-semibold">
                Discussion ({comments.reduce((s, c) => s + 1 + c.replies.length, 0)})
              </h3>
              {comments.length === 0 && (
                <p className="text-content-tertiary text-xs">No comments yet.</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="border-border bg-surface-muted mb-3 rounded border p-3">
                  <div className="text-content-tertiary mb-1 flex items-center gap-2 text-xs">
                    <span className="text-content-secondary font-medium">{c.author_name}</span>
                    <span>{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-content-primary mb-2 text-sm">{c.content}</p>
                  {replyTo === c.id ? (
                    <div className="ml-4 flex gap-2">
                      <input
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        className="border-border bg-surface-primary text-content-primary flex-1 rounded-sm border px-2 py-1 text-xs"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddReply(c.id)}
                      />
                      <button
                        onClick={() => handleAddReply(c.id)}
                        className="bg-accent text-content-inverse rounded px-2 py-1 text-xs"
                      >
                        Reply
                      </button>
                      <button
                        onClick={() => {
                          setReplyTo(null);
                          setReplyText('');
                        }}
                        className="bg-surface-muted text-content-tertiary rounded px-2 py-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReplyTo(c.id)}
                      className="text-accent text-xs hover:underline"
                    >
                      Reply
                    </button>
                  )}
                  {c.replies.map((r) => (
                    <div key={r.id} className="border-accent-muted mt-2 ml-4 border-l-2 pl-3">
                      <div className="text-content-tertiary mb-1 flex items-center gap-2 text-xs">
                        <span className="text-content-secondary font-medium">{r.author_name}</span>
                        <span>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-content-primary text-sm">{r.content}</p>
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment..."
                  className="border-border bg-surface-primary text-content-primary flex-1 rounded-sm border px-3 py-1.5 text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!commentText.trim()}
                  className="bg-accent text-content-inverse rounded px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>

            {decision.status === 'pending' && (
              <div className="border-border bg-surface-primary sticky bottom-0 space-y-3 border-t px-6 py-4">
                {/* Reason (optional) */}
                <textarea
                  placeholder="Reasoning (optional)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="border-border bg-surface-elevated text-content-primary w-full resize-none rounded-sm border px-3 py-2 text-sm"
                />

                {/* Action buttons */}
                <div className="flex gap-2">
                  {decision.options && decision.options.length > 0 && (
                    <select
                      value={selectedOption ?? ''}
                      onChange={(e) => setSelectedOption(e.target.value)}
                      className="border-border bg-surface-primary text-content-primary flex-1 rounded-sm border px-3 py-2 text-sm"
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
                    className="bg-intent-success text-content-inverse hover:bg-intent-success rounded-lg px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="bg-intent-danger text-content-inverse hover:bg-intent-danger rounded-lg px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? '...' : 'Reject'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
