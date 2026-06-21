import { useState, useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/api.js';
import { entityColor } from './EntityNode';

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

  const color = entity ? entityColor(entity.type) : entityColor('memory');

  return (
    <div className="border-border bg-surface-primary flex h-full w-64 shrink-0 flex-col border-l">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-content-secondary text-xs font-semibold">Entity Detail</span>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-secondary rounded-sm p-0.5"
        >
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="text-content-tertiary px-3 py-4 text-xs italic">Loading...</div>
      ) : entity ? (
        <div className="flex-1 overflow-y-auto">
          {/* Entity info */}
          <div className="border-border border-b px-3 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-content-primary truncate text-sm font-medium">
                {entity.name}
              </span>
            </div>
            <div className="text-content-tertiary space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Type</span>
                <span className="bg-surface-muted text-content-secondary rounded-sm px-1.5 py-0.5">
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
                <div className="border-border mt-2 border-t pt-2">
                  <span className="text-content-tertiary text-[10px] tracking-wider uppercase">
                    Metadata
                  </span>
                  {Object.entries(entity.metadata).map(([k, v]) => (
                    <div key={k} className="mt-1 flex justify-between">
                      <span className="text-content-tertiary">{k}</span>
                      <span className="text-content-secondary max-w-[120px] truncate">
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
            <span className="text-content-tertiary text-[10px] font-medium tracking-wider uppercase">
              Relations ({relations.length})
            </span>
            {relations.length === 0 ? (
              <p className="text-content-tertiary mt-1 text-[11px] italic">No relations</p>
            ) : (
              <div className="mt-2 space-y-1">
                {relations.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onFocusEntity(r.direction === 'out' ? r.to : r.from)}
                    className="hover:bg-surface-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[10px] ${
                            r.direction === 'out' ? 'text-intent-success' : 'text-intent-info'
                          }`}
                        >
                          {r.direction === 'out' ? '→' : '←'}
                        </span>
                        <span className="text-content-secondary truncate text-xs">
                          {r.otherEntityName}
                        </span>
                      </div>
                      <div className="text-content-tertiary ml-4 flex items-center gap-2 text-[10px]">
                        <span>{r.relation}</span>
                        <div className="bg-surface-muted h-1 w-12 overflow-hidden rounded-full">
                          <div
                            className="bg-accent h-full rounded-full"
                            style={{ width: `${Math.min(100, r.strength * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <ExternalLink size={10} className="text-content-tertiary shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-content-tertiary px-3 py-4 text-xs italic">
          Select an entity to view details
        </div>
      )}
    </div>
  );
}
