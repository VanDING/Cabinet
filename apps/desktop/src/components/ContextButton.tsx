import { useState, useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

export function ContextButton({
  sessionId,
  btnBaseClass,
  hoverClass,
  dropdownBgClass,
}: {
  sessionId: string;
  btnBaseClass: string;
  hoverClass: string;
  dropdownBgClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{
    messageCount?: number;
    estimatedTokens?: number;
    maxContextTokens?: number;
  } | null>(null);
  const [compacting, setCompacting] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  const fetchContext = () => {
    setOpen(!open);
    if (!open) {
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
    <div className="relative">
      <button
        ref={btnRef}
        onClick={fetchContext}
        className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${btnBaseClass} ${hoverClass}`}
        title="View context usage"
      >
        <FileText size={12} />
        Context: {data ? `${pct}%` : '--'}
      </button>
      {open && (
        <div
          className={`absolute bottom-full right-0 z-50 mb-1 w-56 rounded-lg border p-3 shadow-xl ${dropdownBgClass} text-xs`}
        >
          <div className="mb-2 font-medium text-gray-700">Context Usage</div>
          {data ? (
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Messages</span>
                <span className="font-mono text-gray-700">
                  {data.messageCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Est. Tokens</span>
                <span className="font-mono text-gray-700">
                  {tokens.toLocaleString()} / {max.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200">
                <div
                  className={`h-1.5 rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-blue-500'}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <button
                onClick={handleCompact}
                disabled={compacting}
                className="mt-2 w-full rounded bg-blue-600 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {compacting ? 'Compacting...' : 'Compact Context'}
              </button>
            </div>
          ) : (
            <p className="italic text-gray-400">Loading...</p>
          )}
        </div>
      )}
    </div>
  );
}
