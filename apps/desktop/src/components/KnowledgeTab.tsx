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
  activeProjectId?: string | null;
}

export function KnowledgeTab({ activeProjectId }: Props) {
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
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [projectId]);

  const fetchChunks = async (path: string) => {
    setSelectedDoc(path);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/documents/${encodeURIComponent(path)}`,
      );
      if (res.ok) setChunks((await res.json()).chunks ?? []);
    } catch {
      /* ignore */
    }
  };

  const handleClear = async (path?: string) => {
    const url = path
      ? `/api/projects/${projectId}/documents?path=${encodeURIComponent(path)}`
      : `/api/projects/${projectId}/documents`;
    await apiFetch(url, { method: 'DELETE', headers: authJsonHeaders() });
    if (path && selectedDoc === path) {
      setSelectedDoc(null);
      setChunks([]);
    }
    fetchDocs();
  };

  const borderClasses = 'border-gray-200';
  const inputClasses =
    'rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-900';
  const textClasses = 'text-gray-800';
  const subClasses = 'text-gray-500';

  return (
    <div className="flex h-full">
      {/* Left: Document list */}
      <div className="flex w-64 flex-shrink-0 flex-col border-r border-gray-200">
        <div className="border-b border-gray-200 p-3">
          <input
            className={`w-full ${inputClasses}`}
            placeholder="Search query..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-auto">
          {docs.length === 0 ? (
            <p className={`p-3 text-xs ${subClasses}`}>
              No indexed documents. Use chat to index files with the index_document tool.
            </p>
          ) : (
            docs.map((d) => (
              <div
                key={d.path}
                onClick={() => fetchChunks(d.path)}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-xs ${
                  selectedDoc === d.path
                    ? 'bg-blue-50'
                    : ''
                } hover:bg-gray-100:bg-gray-700`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileText size={12} className="flex-shrink-0" />
                  <span className={`truncate ${textClasses}`}>{d.path.split('/').pop()}</span>
                </div>
                <span className={`ml-2 flex-shrink-0 ${subClasses}`}>{d.chunks}c</span>
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
              <h3 className={`text-sm font-semibold ${textClasses}`}>{selectedDoc}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleClear(selectedDoc)}
                  className={`flex items-center gap-1 text-xs ${subClasses} hover:text-red-500`}
                >
                  <Trash2 size={12} /> Clear
                </button>
                <button
                  onClick={() => {
                    setSelectedDoc(selectedDoc);
                    fetchChunks(selectedDoc);
                  }}
                  className={`flex items-center gap-1 text-xs ${subClasses}`}
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            </div>
            {chunks.map((chunk) => (
              <div
                key={chunk.id}
                className={`rounded border ${borderClasses} bg-white p-3`}
              >
                <div className={`mb-1 text-xs ${subClasses}`}>Chunk {chunk.index}</div>
                <pre className={`whitespace-pre-wrap font-sans text-xs ${textClasses}`}>
                  {chunk.content.slice(0, 1000)}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <div className={`flex h-full items-center justify-center ${subClasses}`}>
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
