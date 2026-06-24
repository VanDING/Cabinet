//
// ActivityFeed — real-time stream of agent events.
//
// Shows: task completions, Slot discoveries, Decision pushes, telemetry summaries.
// Subscribes to WebSocket agent_event channel for live updates.
//

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';
import { useEventBus } from '../contexts/EventBusContext';

// ── Types ────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  type: 'task_completed' | 'discovery' | 'decision' | 'telemetry' | 'error';
  timestamp: string;
  agentId: string;
  agentName?: string;
  taskId?: string;
  summary: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

// ── Component ────────────────────────────────────────────────────

export const ActivityFeed: React.FC<{ maxItems?: number }> = ({ maxItems = 50 }) => {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const { on } = useEventBus();

  // ── Listen to shared EventBus for agent activity ──────────────

  useEffect(() => {
    const handleAgentEvent = (type: string, data: Record<string, unknown>) => {
      const event: ActivityEvent = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: (data.type as ActivityEvent['type']) ?? 'task_completed',
        timestamp: (data.timestamp as string) ?? new Date().toISOString(),
        agentId: (data.agentId as string) ?? (data.agent_type as string) ?? 'unknown',
        agentName: data.agentName as string | undefined,
        taskId: data.taskId as string | undefined,
        summary: (data.summary as string) ?? (data.message as string) ?? '',
        detail: data.detail as string | undefined,
        metadata: data.metadata as Record<string, unknown> | undefined,
      };
      setEvents((prev) => [event, ...prev].slice(0, maxItems));
    };

    const activityEvents = [
      'task_completed',
      'task_failed',
      'task_progress',
      'decision_created',
      'decision_updated',
      'workflow_completed',
      'deliverable_created',
      'agent_heartbeat',
      'agent_event',
    ];

    const unsubs = activityEvents.map((evt) =>
      on(evt, (data) => handleAgentEvent(evt, data as Record<string, unknown>)),
    );
    return () => unsubs.forEach((u) => u());
  }, [on, maxItems]);

  // ── Also fetch initial events via REST ────────────────────────

  const fetchInitialEvents = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/external/decisions?status=all&limit=20');
      if (resp.ok) {
        const data = (await resp.json()) as {
          decisions?: Array<{ id: string; title: string; createdAt: string }>;
        };
        const decisionEvents: ActivityEvent[] = (data.decisions ?? []).map((d) => ({
          id: d.id,
          type: 'decision' as const,
          timestamp: d.createdAt,
          agentId: 'system',
          summary: d.title,
        }));
        setEvents((prev) => {
          const existing = new Set(prev.map((e) => e.id));
          return [...prev, ...decisionEvents.filter((e) => !existing.has(e.id))].slice(0, maxItems);
        });
      }
    } catch {
      /* non-critical */
    }
  }, [maxItems]);

  useEffect(() => {
    fetchInitialEvents();
  }, [fetchInitialEvents]);

  // ── Render helpers ────────────────────────────────────────────

  const eventIcon = (type: string) => {
    switch (type) {
      case 'task_completed':
        return '✅';
      case 'discovery':
        return '🔍';
      case 'decision':
        return '⚠️';
      case 'telemetry':
        return '📊';
      case 'error':
        return '❌';
      default:
        return '📌';
    }
  };

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="bg-surface-dark border-divider flex h-full flex-col border-l">
      {/* Header */}
      <div className="border-divider flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-content-primary text-sm font-semibold">Activity Feed</h3>
        <span className="h-2 w-2 rounded-full bg-green-400" />
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 && (
          <div className="text-content-tertiary p-4 text-center text-sm">
            No activity yet. Events will appear here as agents work.
          </div>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="border-divider/50 hover:bg-surface-elevated/50 border-b px-3 py-2 transition-colors"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-sm">{eventIcon(event.type)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-content-secondary truncate text-xs font-medium">
                    {event.summary}
                  </span>
                  <span className="text-content-tertiary ml-auto text-xs whitespace-nowrap">
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-content-tertiary mt-0.5 truncate text-xs">{event.detail}</p>
                )}
                <div className="mt-0.5 flex items-center gap-2">
                  {event.agentName && (
                    <span className="text-content-tertiary text-xs">{event.agentName}</span>
                  )}
                  {(event.metadata?.tokens as number) > 0 && (
                    <span className="text-content-tertiary text-xs">
                      🪙 {((event.metadata!.tokens as number) / 1000).toFixed(1)}k tokens
                    </span>
                  )}
                  {(event.metadata?.duration as number) > 0 && (
                    <span className="text-content-tertiary text-xs">
                      ⚡ {(event.metadata!.duration as number) / 1000}s
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-divider text-content-tertiary flex justify-between border-t px-3 py-1.5 text-xs">
        <span>{events.length} events</span>
        <button className="hover:text-content-secondary" onClick={() => setEvents([])}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default ActivityFeed;
