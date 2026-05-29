import { useState, useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { TYPE_COLORS } from './EntityNode';

interface EntityDetail {
  id: string;
  name: string;
  type: string;
  frequency: number;
  first_seen?: string;
  last_seen?: string;
  metadata: Record<string, unknown>;
}

interface RelationDetail {
  id: string;
  from: string;
  to: string;
  relation: string;
  strength: number;
  otherEntityName: string;
  otherEntityType: string;
  direction: 'out' | 'in';
}

interface Props {
  entityId: string | null;
  onClose: () => void;
  onFocusEntity: (id: string) => void;
}

export function GraphDetailPanel({ entityId, onClose, onFocusEntity }: Props) {
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [relations, setRelations] = useState<RelationDetail[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId) {
      setEntity(null);
      setRelations([]);
      return;
    }
    setLoading(true);
    Promise.all([
      apiFetch(`/api/memory/graph/entity/${entityId}`, { headers: authHeaders() }).then((r) =>
        r.ok ? r.json() : null,
      ),
      apiFetch(`/api/memory/graph/entity/${entityId}/relations`, {
        headers: authHeaders(),
      }).then((r) => (r.ok ? r.json() : { relations: [] })),
    ])
      .then(([ent, rel]) => {
        if (ent && !ent.error) setEntity(ent);
        else setEntity(null);
        setRelations(rel?.relations ?? []);
      })
      .catch(() => {
        setEntity(null);
        setRelations([]);
      })
      .finally(() => setLoading(false));
  }, [entityId]);

  if (!entityId) return null;

  const color = entity ? TYPE_COLORS[entity.type] ?? '#6b7280' : '#6b7280';

  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col border-l border-border bg-surface-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-content-secondary">Entity Detail</span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-content-tertiary hover:text-content-secondary"
        >
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="px-3 py-4 text-xs text-content-tertiary italic">Loading...</div>
      ) : entity ? (
        <div className="flex-1 overflow-y-auto">
          {/* Entity info */}
          <div className="border-b border-border px-3 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="truncate text-sm font-medium text-content-primary">
                {entity.name}
              </span>
            </div>
            <div className="space-y-1 text-[11px] text-content-tertiary">
              <div className="flex justify-between">
                <span>Type</span>
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-content-secondary">
                  {entity.type}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Frequency</span>
                <span className="text-content-secondary">{entity.frequency}</span>
              </div>
              {entity.first_seen && (
                <div className="flex justify-between">
                  <span>First seen</span>
                  <span className="text-content-secondary">
                    {new Date(entity.first_seen).toLocaleDateString()}
                  </span>
                </div>
              )}
              {entity.last_seen && (
                <div className="flex justify-between">
                  <span>Last seen</span>
                  <span className="text-content-secondary">
                    {new Date(entity.last_seen).toLocaleDateString()}
                  </span>
                </div>
              )}
              {entity.metadata && Object.keys(entity.metadata).length > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <span className="text-[10px] uppercase tracking-wider text-content-tertiary">
                    Metadata
                  </span>
                  {Object.entries(entity.metadata).map(([k, v]) => (
                    <div key={k} className="mt-1 flex justify-between">
                      <span className="text-content-tertiary">{k}</span>
                      <span className="max-w-[120px] truncate text-content-secondary">
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Relations */}
          <div className="px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-content-tertiary">
              Relations ({relations.length})
            </span>
            {relations.length === 0 ? (
              <p className="mt-1 text-[11px] text-content-tertiary italic">No relations</p>
            ) : (
              <div className="mt-2 space-y-1">
                {relations.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onFocusEntity(r.direction === 'out' ? r.to : r.from)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[10px] ${
                            r.direction === 'out'
                              ? 'text-intent-success'
                              : 'text-intent-info'
                          }`}
                        >
                          {r.direction === 'out' ? '→' : '←'}
                        </span>
                        <span className="truncate text-xs text-content-secondary">
                          {r.otherEntityName}
                        </span>
                      </div>
                      <div className="ml-4 flex items-center gap-2 text-[10px] text-content-tertiary">
                        <span>{r.relation}</span>
                        <div className="h-1 w-12 overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${Math.min(100, r.strength * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <ExternalLink size={10} className="flex-shrink-0 text-content-tertiary" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 py-4 text-xs text-content-tertiary italic">
          Select an entity to view details
        </div>
      )}
    </div>
  );
}
