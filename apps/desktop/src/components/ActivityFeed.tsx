//
// ActivityFeed — real-time stream of agent events.
//
// Shows: task completions, Slot discoveries, Decision pushes, telemetry summaries.
// Subscribes to WebSocket agent_event channel for live updates.
//

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

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
  const [wsConnected, setWsConnected] = useState(false);

  // ── WebSocket subscription ────────────────────────────────────

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'tauri.localhost' ? 'localhost:3000' : window.location.host;
    const wsUrl = `${protocol}//${host}/ws/events`;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    const maxRetries = 5;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
        retryCount = 0;
        ws.send(JSON.stringify({ type: 'subscribe', channel: 'agent_event' }));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.channel === 'agent_event' || data.type === 'agent_event') {
            const event: ActivityEvent = {
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: data.event?.type ?? data.type ?? 'task_completed',
              timestamp: data.timestamp ?? new Date().toISOString(),
              agentId: data.agentId ?? data.event?.agentId ?? 'unknown',
              agentName: data.agentName,
              taskId: data.taskId,
              summary: data.summary ?? data.event?.summary ?? '',
              detail: data.detail,
              metadata: data.metadata ?? data.event?.metadata,
            };
            setEvents((prev) => [event, ...prev].slice(0, maxItems));
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (retryCount < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          retryCount++;
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [maxItems]);

  // ── Also fetch initial events via REST ────────────────────────

  const fetchInitialEvents = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/external/decisions?status=all&limit=20');
      if (resp.ok) {
        const data = await resp.json() as { decisions?: Array<{ id: string; title: string; createdAt: string }> };
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
    } catch { /* non-critical */ }
  }, [maxItems]);

  useEffect(() => { fetchInitialEvents(); }, [fetchInitialEvents]);

  // ── Render helpers ────────────────────────────────────────────

  const eventIcon = (type: string) => {
    switch (type) {
      case 'task_completed': return '✅';
      case 'discovery': return '🔍';
      case 'decision': return '⚠️';
      case 'telemetry': return '📊';
      case 'error': return '❌';
      default: return '📌';
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
    <div className="h-full flex flex-col bg-surface-dark border-l border-divider">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-divider">
        <h3 className="text-sm font-semibold text-content-primary">Activity Feed</h3>
        <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-red-400'}`} />
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 && (
          <div className="p-4 text-center text-content-tertiary text-sm">
            No activity yet. Events will appear here as agents work.
          </div>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="px-3 py-2 border-b border-divider/50 hover:bg-surface-elevated/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <span className="text-sm mt-0.5">{eventIcon(event.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-content-secondary truncate">
                    {event.summary}
                  </span>
                  <span className="text-xs text-content-tertiary whitespace-nowrap ml-auto">
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-content-tertiary mt-0.5 truncate">{event.detail}</p>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  {event.agentName && (
                    <span className="text-xs text-content-tertiary">{event.agentName}</span>
                  )}
                  {(event.metadata?.tokens as number) > 0 && (
                    <span className="text-xs text-content-tertiary">
                      🪙 {((event.metadata!.tokens as number) / 1000).toFixed(1)}k tokens
                    </span>
                  )}
                  {(event.metadata?.duration as number) > 0 && (
                    <span className="text-xs text-content-tertiary">
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
      <div className="px-3 py-1.5 border-t border-divider text-xs text-content-tertiary flex justify-between">
        <span>{events.length} events</span>
        <button
          className="hover:text-content-secondary"
          onClick={() => setEvents([])}
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default ActivityFeed;
