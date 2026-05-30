import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Search,
  Eye,
  Plus,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Paperclip,
} from 'lucide-react';
import type { AttachedFile } from '../hooks/useSessions';
import { apiFetch, authHeaders } from '../utils/pin.js';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';
import { useToast } from './Toast';

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
  onAddFile: (sessionId: string, file: AttachedFile) => void;
  activeSessionId?: string;
}

export function ProjectExplorer({
  projectId,
  projectName,
  onAddFile,
  activeSessionId,
}: Props) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const { addToast } = useToast();

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
      .catch(() => {
        setFiles([]);
      })
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const clickTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleFileClick = useCallback(
    (node: FileNode) => {
      if (node.type === 'directory') {
        toggleExpand(node.path);
        return;
      }
      const existing = clickTimers.current.get(node.path);
      if (existing) {
        // Double click — attach to chat
        clearTimeout(existing);
        clickTimers.current.delete(node.path);
        if (activeSessionId) {
          onAddFile(activeSessionId, {
            id: `f_${Date.now()}`,
            name: node.name,
            path: node.path,
            type: 'project',
          });
        }
      } else {
        // Single click — preview after 250ms (canceled if double-click arrives)
        const timer = setTimeout(() => {
          clickTimers.current.delete(node.path);
          window.dispatchEvent(
            new CustomEvent('open-file-viewer', {
              detail: { path: node.path, name: node.name, projectId },
            }),
          );
        }, 250);
        clickTimers.current.set(node.path, timer);
      }
    },
    [projectId, activeSessionId, onAddFile],
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const commitRename = useCallback(
    (path: string) => {
      const newName = renameValue.trim();
      const oldName = path.split('/').pop() || path;
      setRenamingPath(null);
      if (!newName || newName === oldName) return;
      apiFetch('/api/files/rename', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, newName, projectId }),
      })
        .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
        .then(() => {
          addToast('success', `Renamed to ${newName}`);
          refresh();
        })
        .catch((e) => addToast('error', `Rename failed: ${e?.error ?? e}`));
    },
    [renameValue, projectId, addToast],
  );

  const buildMenuEntries = useCallback(
    (node: FileNode): ContextMenuEntry[] => {
      const sep = navigator.platform.startsWith('Win') ? '\\' : '/';
      const absolutePath = rootPath
        ? `${rootPath.replace(/[/\\]$/, '')}${sep}${node.path.replace(/\//g, sep)}`
        : node.path;

      if (node.type === 'file') {
        return [
          {
            type: 'item',
            item: {
              label: 'Open',
              icon: <Eye size={13} />,
              onClick: () => {
                window.dispatchEvent(
                  new CustomEvent('open-file-viewer', {
                    detail: { path: node.path, name: node.name, projectId },
                  }),
                );
              },
            },
          },
          {
            type: 'item',
            item: {
              label: 'Add to Chat',
              icon: <Paperclip size={13} />,
              onClick: () => {
                if (activeSessionId) {
                  onAddFile(activeSessionId, {
                    id: `f_${Date.now()}`,
                    name: node.name,
                    path: node.path,
                    type: 'project',
                  });
                  addToast('success', `Attached: ${node.name}`);
                }
              },
              disabled: !activeSessionId,
            },
          },
          { type: 'separator' },
          {
            type: 'item',
            item: {
              label: 'Rename',
              icon: <Pencil size={13} />,
              onClick: () => {
                setRenamingPath(node.path);
                setRenameValue(node.name);
              },
            },
          },
          {
            type: 'item',
            item: {
              label: 'Delete',
              icon: <Trash2 size={13} />,
              danger: true,
              onClick: () => {
                if (!window.confirm(`Delete "${node.name}"?`)) return;
                const qs = `path=${encodeURIComponent(node.path)}&projectId=${encodeURIComponent(projectId ?? '')}`;
                apiFetch(`/api/files?${qs}`, {
                  method: 'DELETE',
                  headers: authHeaders(),
                })
                  .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
                  .then(() => {
                    addToast('success', `Deleted ${node.name}`);
                    refresh();
                  })
                  .catch((e) => addToast('error', `Delete failed: ${e?.error ?? e}`));
              },
            },
          },
          { type: 'separator' },
          {
            type: 'item',
            item: {
              label: 'Copy Path',
              icon: <Copy size={13} />,
              onClick: () => {
                navigator.clipboard.writeText(node.path).then(
                  () => addToast('success', 'Path copied'),
                  () => addToast('error', 'Failed to copy path'),
                );
              },
            },
          },
          {
            type: 'item',
            item: {
              label: 'Open in System',
              icon: <ExternalLink size={13} />,
              onClick: () => {
                if (!rootPath) {
                  addToast('error', 'Project path not available');
                  return;
                }
                import('@tauri-apps/plugin-opener')
                  .then((m) => m.openPath(absolutePath))
                  .catch(() => addToast('error', 'Failed to open file'));
              },
            },
          },
        ];
      }

      // Directory context menu
      return [
        {
          type: 'item',
          item: {
            label: 'New File',
            icon: <FilePlus size={13} />,
            onClick: () => {
              const name = window.prompt('File name:');
              if (!name) return;
              apiFetch('/api/files/file', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentPath: node.path, name, projectId }),
              })
                .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
                .then(() => {
                  addToast('success', `Created ${name}`);
                  refresh();
                })
                .catch((e) => addToast('error', `Create failed: ${e?.error ?? e}`));
            },
          },
        },
        {
          type: 'item',
          item: {
            label: 'New Folder',
            icon: <FolderPlus size={13} />,
            onClick: () => {
              const name = window.prompt('Folder name:');
              if (!name) return;
              apiFetch('/api/files/directory', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentPath: node.path, name, projectId }),
              })
                .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
                .then(() => {
                  addToast('success', `Created ${name}/`);
                  refresh();
                })
                .catch((e) => addToast('error', `Create failed: ${e?.error ?? e}`));
            },
          },
        },
        { type: 'separator' },
        {
          type: 'item',
          item: {
            label: 'Rename',
            icon: <Pencil size={13} />,
            onClick: () => {
              setRenamingPath(node.path);
              setRenameValue(node.name);
            },
          },
        },
        {
          type: 'item',
          item: {
            label: 'Delete',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => {
              if (!window.confirm(`Delete "${node.name}" and all contents?`)) return;
              const qs = `path=${encodeURIComponent(node.path)}&projectId=${encodeURIComponent(projectId ?? '')}`;
              apiFetch(`/api/files?${qs}`, {
                method: 'DELETE',
                headers: authHeaders(),
              })
                .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
                .then(() => {
                  addToast('success', `Deleted ${node.name}`);
                  refresh();
                })
                .catch((e) => addToast('error', `Delete failed: ${e?.error ?? e}`));
            },
          },
        },
        { type: 'separator' },
        {
          type: 'item',
          item: {
            label: 'Copy Path',
            icon: <Copy size={13} />,
            onClick: () => {
              navigator.clipboard.writeText(node.path).then(
                () => addToast('success', 'Path copied'),
                () => addToast('error', 'Failed to copy path'),
              );
            },
          },
        },
        {
          type: 'item',
          item: {
            label: 'Open in File Manager',
            icon: <ExternalLink size={13} />,
            onClick: () => {
              if (!rootPath) {
                addToast('error', 'Project path not available');
                return;
              }
              import('@tauri-apps/plugin-opener')
                .then((m) => m.openPath(absolutePath))
                .catch(() => addToast('error', 'Failed to open folder'));
            },
          },
        },
      ];
    },
    [projectId, activeSessionId, rootPath, onAddFile, addToast],
  );

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
  const bg = 'bg-surface-primary';
  const border = 'border-border';

  return (
    <div className={`flex h-full w-56 shrink-0 flex-col border-r ${border} ${bg}`}>
      {/* Header */}
      <div className={`shrink-0 border-b px-3 py-2 ${border}`}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Folder size={14} className="text-accent" />
          <span className="truncate text-xs font-medium text-content-secondary">
            {projectName ?? 'Project'}
          </span>
        </div>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 text-content-tertiary"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full rounded-sm border border-border bg-surface-elevated py-0.5 pl-6 pr-2 text-xs text-content-secondary focus:outline-hidden focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-2 text-xs italic text-content-tertiary">Loading...</p>
        ) : displayFiles.length === 0 ? (
          <p className="px-3 py-2 text-xs italic text-content-tertiary">
            {rootPath ? 'No files found' : 'No folder imported'}
          </p>
        ) : (
          <FileTree
            nodes={displayFiles}
            expanded={expanded}
            onToggle={toggleExpand}
            onFileClick={handleFileClick}
            onContextMenu={(e, node) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, node });
            }}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onCommitRename={commitRename}
            depth={0}
          />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.node.name}
          entries={buildMenuEntries(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function FileTree({
  nodes,
  expanded,
  onToggle,
  onFileClick,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  depth,
}: {
  nodes: FileNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (node: FileNode) => void;
  onContextMenu: (e: ReactMouseEvent, node: FileNode) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onCommitRename: (path: string) => void;
  depth: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isDir = node.type === 'directory';
        const hoverClass = 'hover:bg-surface-muted bg-surface-primary';

        return (
          <div key={node.path}>
            <button
              onClick={() => onFileClick(node)}
              onContextMenu={(e) => onContextMenu(e, node)}
              className={`flex w-full items-center gap-1 py-1 text-left text-xs transition-colors ${hoverClass}`}
              style={{ paddingLeft: `${12 + depth * 12}px`, paddingRight: '8px' }}
              title={node.path}
            >
              {isDir ? (
                <>
                  <span
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(node.path);
                    }}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <Folder size={12} className="shrink-0 text-intent-warning" />
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <File size={12} className="shrink-0 text-content-tertiary" />
                </>
              )}
              {renamingPath === node.path ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => onRenameValueChange(e.target.value)}
                  onBlur={() => onCommitRename(node.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitRename(node.path);
                    if (e.key === 'Escape') onCommitRename(node.path);
                  }}
                  className="min-w-0 flex-1 rounded-sm border border-accent bg-surface-primary px-1 py-0 text-xs text-content-primary outline-hidden"
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate text-content-secondary">{node.name}</span>
              )}
              {node.size !== undefined && renamingPath !== node.path && (
                <span className="ml-auto shrink-0 text-[10px] text-content-tertiary">
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
                onContextMenu={onContextMenu}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onRenameValueChange={onRenameValueChange}
                onCommitRename={onCommitRename}
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
