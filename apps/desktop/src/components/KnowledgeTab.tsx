import { useState, useEffect } from 'react';
import { Search, Trash2, FileText, RefreshCw } from 'lucide-react';
import { apiFetch, authJsonHeaders } from '../utils/pin.js';

interface DocumentInfo {
  path: string;
  chunks: number;
  indexedAt: string;
}

interface ChunkInfo {
  id: string;
  index: number;
  content: string;
  metadata: Record<string, unknown>;
}

interface Props {
  isDark?: boolean;
  activeProjectId?: string | null;
}

export function KnowledgeTab({ isDark, activeProjectId }: Props) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const projectId = activeProjectId ?? 'default';

  const fetchDocs = async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/documents`);
      if (res.ok) setDocs((await res.json()).documents ?? []);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchDocs(); }, [projectId]);

  const fetchChunks = async (path: string) => {
    setSelectedDoc(path);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/documents/${encodeURIComponent(path)}`);
      if (res.ok) setChunks((await res.json()).chunks ?? []);
    } catch { /* ignore */ }
  };

  const handleClear = async (path?: string) => {
    const url = path
      ? `/api/projects/${projectId}/documents?path=${encodeURIComponent(path)}`
      : `/api/projects/${projectId}/documents`;
    await apiFetch(url, { method: 'DELETE', headers: authJsonHeaders() });
    if (path && selectedDoc === path) { setSelectedDoc(null); setChunks([]); }
    fetchDocs();
  };

  const bg = isDark ? 'bg-gray-800' : 'bg-white';
  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const inputBg = isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900';
  const text = isDark ? 'text-gray-200' : 'text-gray-800';
  const sub = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="flex h-full">
      {/* Left: Document list */}
      <div className="w-64 border-r flex-shrink-0 flex flex-col" style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}>
        <div className="p-3 border-b" style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}>
          <input
            className={`w-full rounded border ${border} ${inputBg} px-2 py-1 text-xs`}
            placeholder="Search query..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-auto">
          {docs.length === 0 ? (
            <p className={`p-3 text-xs ${sub}`}>No indexed documents. Use chat to index files with the index_document tool.</p>
          ) : (
            docs.map((d) => (
              <div
                key={d.path}
                onClick={() => fetchChunks(d.path)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer text-xs ${
                  selectedDoc === d.path ? (isDark ? 'bg-blue-900/30' : 'bg-blue-50') : ''
                } ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={12} className="flex-shrink-0" />
                  <span className={`truncate ${text}`}>{d.path.split('/').pop()}</span>
                </div>
                <span className={`flex-shrink-0 ml-2 ${sub}`}>{d.chunks}c</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Chunks / detail */}
      <div className="flex-1 overflow-auto p-4">
        {selectedDoc ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-semibold ${text}`}>{selectedDoc}</h3>
              <div className="flex gap-2">
                <button onClick={() => handleClear(selectedDoc)} className={`flex items-center gap-1 text-xs ${sub} hover:text-red-500`}>
                  <Trash2 size={12} /> Clear
                </button>
                <button onClick={() => { setSelectedDoc(selectedDoc); fetchChunks(selectedDoc); }} className={`flex items-center gap-1 text-xs ${sub}`}>
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            </div>
            {chunks.map((chunk) => (
              <div key={chunk.id} className={`rounded border ${border} ${bg} p-3`}>
                <div className={`text-xs mb-1 ${sub}`}>Chunk {chunk.index}</div>
                <pre className={`text-xs whitespace-pre-wrap font-sans ${text}`}>{chunk.content.slice(0, 1000)}</pre>
              </div>
            ))}
          </div>
        ) : (
          <div className={`flex items-center justify-center h-full ${sub}`}>
            <div className="text-center">
              <Search size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select a document to view chunks</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
