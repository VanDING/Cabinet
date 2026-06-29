import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ContextButton({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<{
    messageCount?: number;
    estimatedTokens?: number;
    maxContextTokens?: number;
  } | null>(null);
  const [compacting, setCompacting] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      apiFetch(`/api/secretary/context?sessionId=${sessionId}`, { headers: authHeaders() })
        .then((r) => r.json())
        .then(setData)
        .catch(() => setData(null));
    }
  };

  const handleCompact = async () => {
    setCompacting(true);
    try {
      await apiFetch('/api/secretary/compact', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ sessionId }),
      });
      const r = await apiFetch(`/api/secretary/context?sessionId=${sessionId}`, {
        headers: authHeaders(),
      });
      setData(await r.json());
    } catch {
      /* compact failed */
    }
    setCompacting(false);
  };

  const tokens = data?.estimatedTokens ?? 0;
  const max = data?.maxContextTokens ?? 200000;
  const pct = max > 0 ? Math.round((tokens / max) * 100) : 0;

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors text-content-tertiary hover:bg-surface-muted"
        title="View context usage"
      >
        <FileText size={12} />
        Context: {data ? `${pct}%` : '--'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-3 text-xs">
        <div className="text-content-secondary mb-2 font-medium">Context Usage</div>
        {data ? (
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-content-tertiary">Messages</span>
              <span className="text-content-secondary font-mono">{data.messageCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-tertiary">Est. Tokens</span>
              <span className="text-content-secondary font-mono">
                {tokens.toLocaleString()} / {max.toLocaleString()}
              </span>
            </div>
            <div className="bg-surface-muted mt-1 h-1.5 w-full rounded-full">
              <div
                className={`h-1.5 rounded-full transition-all ${pct > 80 ? 'bg-intent-danger' : pct > 50 ? 'bg-intent-warning' : 'bg-accent'}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <button
              onClick={handleCompact}
              disabled={compacting}
              className="bg-accent text-content-inverse hover:bg-accent-hover mt-2 w-full rounded-sm py-1 text-xs disabled:opacity-50"
            >
              {compacting ? 'Compacting...' : 'Compact Context'}
            </button>
          </div>
        ) : (
          <p className="text-content-tertiary italic">Loading...</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
