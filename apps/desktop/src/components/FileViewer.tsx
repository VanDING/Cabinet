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

interface Props {
  isDark?: boolean;
}

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];

function safeBtoa(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export function FileViewer({ isDark }: Props) {
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
      const newWidth = Math.min(Math.max(startWidth - (ev.clientX - startX), 320), window.innerWidth * 0.7);
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

  // Listen for custom events from ProjectExplorer or ChatView
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        path: string; name: string; content?: string; encoding?: string; mimeType?: string; projectId?: string;
      };
      if (!detail.path) return;

      // Avoid duplicates
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
        // Fetch content if not provided
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
              t.path === filePath ? { ...t, content: data.content, encoding: data.encoding ?? 'utf-8', mimeType: data.mimeType, absolutePath: data.absolutePath } : t,
            ),
          );
        }
      } catch (err) { console.error('FileViewer fetch failed:', filePath, err); }
    };

    window.addEventListener('open-file-viewer', handler);
    return () => window.removeEventListener('open-file-viewer', handler);
  }, []);

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTab === path) {
        setActiveTab(next.length > 0 ? next[next.length - 1]!.path : null);
      }
      if (next.length === 0) setVisible(false);
      return next;
    });
  }, [activeTab]);

  const closeAll = () => {
    setTabs([]);
    setActiveTab(null);
    setVisible(false);
  };

  // Compute derived state BEFORE any conditional return so hooks are always
  // called in the same order on every render.
  const active = tabs.find((t) => t.path === activeTab);
  const isImage = active?.mimeType && IMAGE_MIMES.includes(active.mimeType);

  if (!visible) return null;

  const bg = isDark ? 'bg-gray-900' : 'bg-white';
  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const tabBg = isDark ? 'bg-gray-800' : 'bg-gray-100';


  return (
    <div className="relative flex flex-shrink-0" style={{ width }}>
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 ${isDark ? 'hover:bg-blue-500' : 'hover:bg-blue-400'}`}
      />
      <div className={`flex flex-col border-l ${border} ${bg} flex-1 min-w-0`}>
        {/* Tab bar */}
        <div className={`flex items-center border-b ${border} ${tabBg} h-9 px-1 gap-0.5 overflow-x-auto`}>
          {tabs.map((tab) => (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={`flex items-center gap-1 px-2 py-1 rounded-t text-xs cursor-pointer whitespace-nowrap flex-shrink-0 ${
                activeTab === tab.path
                  ? `${bg} border-l border-r border-t ${border} -mb-px`
                  : `${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`
              }`}
            >
              {tab.mimeType?.startsWith('image/') ? <Image size={12} /> : <FileCode size={12} />}
              <span className="max-w-[120px] truncate">{tab.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                className={`ml-1 rounded-full p-0.5 ${isDark ? 'hover:bg-gray-600' : 'hover:bg-gray-300'}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button onClick={closeAll} className={`ml-auto mr-2 p-1 rounded ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Close all">
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {active ? (
            isImage ? (
              <div className="flex items-center justify-center h-full p-4">
                <img
                  src={`data:${active.mimeType};base64,${active.encoding === 'base64' ? active.content : safeBtoa(active.content)}`}
                  alt={active.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <pre className={`p-4 text-sm font-mono whitespace-pre-wrap break-all ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                {active.content || '(empty)'}
              </pre>
            )
          ) : (
            <div className={`flex items-center justify-center h-full ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
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
