import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { FolderOpen, X } from 'lucide-react';
import { ProjectExplorer } from '../components/ProjectExplorer';
import { useToast } from '../components/Toast';
import { apiFetch } from '../utils/api.js';

interface FileInfo {
  path: string;
  name: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType?: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

const IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
];

function safeBtoa(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function ProjectWorkplace() {
  const { id: projectId } = useParams<{ id: string }>();
  const { addToast } = useToast();
  const [filePreview, setFilePreview] = useState<FileInfo | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const fetchFileContent = useCallback(
    async (path: string, name: string) => {
      if (!projectId) return;
      setFileLoading(true);
      try {
        const url = `/api/files/read?path=${encodeURIComponent(path)}&projectId=${encodeURIComponent(projectId)}`;
        const res = await apiFetch(url);
        if (res.ok) {
          const data = await res.json();
          setFilePreview({
            path,
            name,
            content: data.content,
            encoding: data.encoding ?? 'utf-8',
            mimeType: data.mimeType,
          });
        }
      } catch {
        addToast('error', 'Failed to load file');
      } finally {
        setFileLoading(false);
      }
    },
    [projectId, addToast],
  );

  const handleFileSelect = useCallback(
    (node: FileNode) => {
      if (node.type === 'file') fetchFileContent(node.path, node.name);
    },
    [fetchFileContent],
  );

  const isImage = filePreview?.mimeType && IMAGE_MIMES.includes(filePreview.mimeType);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── File Tree ── */}
      <div className="border-border bg-surface-primary flex w-[280px] shrink-0 flex-col border-r">
        <div className="border-border shrink-0 border-b px-3 py-2">
          <span className="text-content-secondary text-xs font-medium">Files</span>
        </div>
        {projectId && (
          <div className="flex-1 overflow-hidden">
            <ProjectExplorer
              projectId={projectId}
              onAddFile={() => {}}
              className="w-full border-0"
              onFileSelect={handleFileSelect}
            />
          </div>
        )}
      </div>

      {/* ── File Preview ── */}
      <div className="bg-surface-primary flex min-w-0 flex-1 flex-col overflow-hidden">
        {fileLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : filePreview ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="border-border flex items-center justify-between border-b px-4 py-2">
              <div className="text-content-primary flex items-center gap-2 text-sm">
                <FolderOpen size={14} className="text-content-tertiary" />
                <span className="font-medium">{filePreview.name}</span>
                {filePreview.mimeType && (
                  <span className="text-content-tertiary text-[10px]">{filePreview.mimeType}</span>
                )}
              </div>
              <button
                onClick={() => {
                  setFilePreview(null);
                }}
                className="text-content-tertiary hover:bg-surface-muted hover:text-content-primary rounded-sm p-1"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {isImage ? (
                <div className="flex h-full items-center justify-center p-4">
                  <img
                    src={`data:${filePreview.mimeType};base64,${filePreview.encoding === 'base64' ? filePreview.content : safeBtoa(filePreview.content)}`}
                    alt={filePreview.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <pre className="text-content-primary p-4 font-mono text-sm break-all whitespace-pre-wrap">
                  {filePreview.content || '(empty)'}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="text-content-tertiary flex flex-1 items-center justify-center">
            <div className="text-center">
              <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select a file from the sidebar to preview</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
