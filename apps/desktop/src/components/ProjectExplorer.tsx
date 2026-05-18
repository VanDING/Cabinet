import { useState, useEffect, useMemo } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Search } from 'lucide-react';
import type { AttachedFile } from '../hooks/useSessions';
import { apiFetch, authHeaders } from '../utils/pin.js';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
}

interface Props {
  projectId: string | null;
  projectName?: string;
  isDark?: boolean;
  onAddFile: (sessionId: string, file: AttachedFile) => void;
  activeSessionId?: string;
}

export function ProjectExplorer({ projectId, projectName, isDark, onAddFile, activeSessionId }: Props) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setFiles([]);
      setRootPath(null);
      return;
    }
    setLoading(true);
    apiFetch(`/api/projects/${projectId}/files`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setFiles(d.files ?? []);
        setRootPath(d.rootPath ?? null);
      })
      .catch(() => { setFiles([]); })
      .finally(() => setLoading(false));
  }, [projectId]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleFileClick = (node: FileNode) => {
    if (node.type === 'directory') {
      toggleExpand(node.path);
      return;
    }
    // Open in FileViewer
    window.dispatchEvent(new CustomEvent('open-file-viewer', {
      detail: { path: node.path, name: node.name },
    }));
    if (activeSessionId) {
      onAddFile(activeSessionId, {
        id: `f_${Date.now()}`,
        name: node.name,
        path: node.path,
        type: 'project',
      });
    }
  };

  const filteredFiles = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const filter = (nodes: FileNode[]): FileNode[] => {
      const result: FileNode[] = [];
      for (const n of nodes) {
        const match = n.name.toLowerCase().includes(q);
        if (n.type === 'directory' && n.children) {
          const childMatches = filter(n.children);
          if (childMatches.length > 0 || match) {
            result.push({ ...n, children: childMatches.length > 0 ? childMatches : n.children });
          }
        } else if (match) {
          result.push(n);
        }
      }
      return result;
    };
    return filter(files);
  }, [files, query]);

  if (!projectId) return null;

  const displayFiles = filteredFiles ?? files;
  const bg = isDark ? 'bg-gray-900' : 'bg-white';
  const border = isDark ? 'border-gray-700' : 'border-gray-200';

  return (
    <div className={`flex h-full w-56 flex-shrink-0 flex-col border-r ${border} ${bg}`}>
      {/* Header */}
      <div className={`flex-shrink-0 border-b px-3 py-2 ${border}`}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Folder size={14} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
          <span className={`truncate text-xs font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
            {projectName ?? 'Project'}
          </span>
        </div>
        <div className="relative">
          <Search
            size={12}
            className={`absolute left-1.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files..."
            className={`w-full rounded border py-0.5 pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              isDark
                ? 'border-gray-600 bg-gray-800 text-gray-200'
                : 'border-gray-200 bg-gray-50 text-gray-700'
            }`}
          />
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className={`px-3 py-2 text-xs italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading...
          </p>
        ) : displayFiles.length === 0 ? (
          <p className={`px-3 py-2 text-xs italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {rootPath ? 'No files found' : 'No folder imported'}
          </p>
        ) : (
          <FileTree
            nodes={displayFiles}
            expanded={expanded}
            onToggle={toggleExpand}
            onFileClick={handleFileClick}
            isDark={isDark}
            depth={0}
          />
        )}
      </div>
    </div>
  );
}

function FileTree({
  nodes,
  expanded,
  onToggle,
  onFileClick,
  isDark,
  depth,
}: {
  nodes: FileNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (node: FileNode) => void;
  isDark?: boolean;
  depth: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isDir = node.type === 'directory';
        const hoverClass = isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100';

        return (
          <div key={node.path}>
            <button
              onClick={() => onFileClick(node)}
              className={`flex w-full items-center gap-1 py-1 text-left text-xs transition-colors ${hoverClass}`}
              style={{ paddingLeft: `${12 + depth * 12}px`, paddingRight: '8px' }}
              title={node.path}
            >
              {isDir ? (
                <>
                  <span className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}>
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <Folder size={12} className={`flex-shrink-0 ${isDark ? 'text-amber-500' : 'text-amber-600'}`} />
                </>
              ) : (
                <>
                  <span className="w-3 flex-shrink-0" />
                  <File size={12} className={`flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                </>
              )}
              <span className={`truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {node.name}
              </span>
              {node.size !== undefined && (
                <span className={`ml-auto flex-shrink-0 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {formatSize(node.size)}
                </span>
              )}
            </button>
            {isDir && isExpanded && node.children && (
              <FileTree
                nodes={node.children}
                expanded={expanded}
                onToggle={onToggle}
                onFileClick={onFileClick}
                isDark={isDark}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
