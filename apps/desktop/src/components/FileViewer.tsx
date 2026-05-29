import { useState, useEffect, useCallback } from 'react';
import { X, ChevronRight, File, Image, FileCode } from 'lucide-react';
import { apiFetch } from '../utils/pin.js';

interface FileTab {
  path: string;
  name: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType?: string;
  absolutePath?: string;
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

export function FileViewer() {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('fileViewerWidth');
    return saved ? parseInt(saved, 10) : Math.round(window.innerWidth * 0.4);
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.min(
        Math.max(startWidth - (ev.clientX - startX), 320),
        window.innerWidth * 0.7,
      );
      setWidth(newWidth);
      localStorage.setItem('fileViewerWidth', String(newWidth));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        path: string;
        name: string;
        content?: string;
        encoding?: string;
        mimeType?: string;
        projectId?: string;
      };
      if (!detail.path) return;

      setTabs((prev) => {
        const existing = prev.find((t) => t.path === detail.path);
        if (existing) {
          setActiveTab(detail.path);
          setVisible(true);
          return prev;
        }
        const newTab: FileTab = {
          path: detail.path,
          name: detail.name ?? detail.path.split('/').pop() ?? detail.path,
          content: detail.content ?? '',
          encoding: (detail.encoding as 'utf-8' | 'base64') ?? 'utf-8',
          mimeType: detail.mimeType,
          absolutePath: (detail as any).absolutePath,
        };
        setActiveTab(detail.path);
        setVisible(true);
        if (!detail.content) {
          fetchFileContent(detail.path, newTab, detail.projectId);
        }
        return [...prev, newTab];
      });
    };

    const fetchFileContent = async (filePath: string, tab: FileTab, projectId?: string) => {
      try {
        let url = `/api/files/read?path=${encodeURIComponent(filePath)}`;
        if (projectId) url += `&projectId=${encodeURIComponent(projectId)}`;
        const res = await apiFetch(url);
        if (res.ok) {
          const data = await res.json();
          setTabs((prev) =>
            prev.map((t) =>
              t.path === filePath
                ? {
                    ...t,
                    content: data.content,
                    encoding: data.encoding ?? 'utf-8',
                    mimeType: data.mimeType,
                    absolutePath: data.absolutePath,
                  }
                : t,
            ),
          );
        }
      } catch (err) {
        console.error('FileViewer fetch failed:', filePath, err);
      }
    };

    window.addEventListener('open-file-viewer', handler);
    return () => window.removeEventListener('open-file-viewer', handler);
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.path !== path);
        if (activeTab === path) {
          setActiveTab(next.length > 0 ? next[next.length - 1]!.path : null);
        }
        if (next.length === 0) setVisible(false);
        return next;
      });
    },
    [activeTab],
  );

  const closeAll = () => {
    setTabs([]);
    setActiveTab(null);
    setVisible(false);
  };

  const active = tabs.find((t) => t.path === activeTab);
  const isImage = active?.mimeType && IMAGE_MIMES.includes(active.mimeType);

  if (!visible) return null;

  const bg = 'bg-white';
  const border = 'border-gray-200';
  const tabBg = 'bg-gray-100';

  return (
    <div className="relative flex flex-shrink-0" style={{ width }}>
      <div
        onMouseDown={handleMouseDown}
        className="absolute bottom-0 left-0 top-0 z-10 w-1 cursor-col-resize hover:bg-blue-400:bg-blue-500"
      />
      <div className={`flex min-w-0 flex-1 flex-col border-l ${border} ${bg}`}>
        {/* Tab bar */}
        <div
          className={`flex h-9 items-center gap-0.5 overflow-x-auto border-b px-1 ${border} ${tabBg}`}
        >
          {tabs.map((tab) => (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={`flex flex-shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-t px-2 py-1 text-xs ${
                activeTab === tab.path
                  ? `${bg} -mb-px border-l border-r border-t ${border}`
                  : 'text-gray-500 hover:text-gray-700:text-gray-200'
              }`}
            >
              {tab.mimeType?.startsWith('image/') ? <Image size={12} /> : <FileCode size={12} />}
              <span className="max-w-[120px] truncate">{tab.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.path);
                }}
                className="ml-1 rounded-full p-0.5 hover:bg-gray-300:bg-gray-600"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button
            onClick={closeAll}
            className="ml-auto mr-2 rounded p-1 hover:bg-gray-200:bg-gray-700"
            title="Close all"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {active ? (
            isImage ? (
              <div className="flex h-full items-center justify-center p-4">
                <img
                  src={`data:${active.mimeType};base64,${active.encoding === 'base64' ? active.content : safeBtoa(active.content)}`}
                  alt={active.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-all p-4 font-mono text-sm text-gray-800">
                {active.content || '(empty)'}
              </pre>
            )
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              <div className="text-center">
                <ChevronRight size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click a file in Project Explorer to preview</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
