import { useState, useCallback, useEffect } from 'react';
import GridLayout, { type Layout, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { StatCard } from '../components/office/StatCard';
import { DecisionList } from '../components/office/DecisionList';
import { EventTimeline } from '../components/office/EventTimeline';
import { ProjectSwitcherWidget } from '../components/office/ProjectSwitcherWidget';
import { PlaceholderWidget } from '../components/office/PlaceholderWidget';
import { useProject } from '../hooks/useProject';

type WidgetType =
  | 'pending-decisions'
  | 'today-cost'
  | 'active-projects'
  | 'active-workflows'
  | 'decision-list'
  | 'event-timeline'
  | 'project-switcher'
  | 'cost-chart'
  | 'system-health'
  | 'llm-stats'
  | 'calendar'
  | 'clock'
  | 'weather'
  | 'deliverables'
  | 'project-list'
  | 'api-switcher';

interface WidgetDef {
  type: WidgetType;
  label: string;
  w: number;
  h: number;
  available: boolean;
}

const WIDGET_POOL: WidgetDef[] = [
  { type: 'pending-decisions', label: 'Pending Decisions', w: 3, h: 1, available: true },
  { type: 'today-cost', label: "Today's Cost", w: 3, h: 1, available: true },
  { type: 'active-projects', label: 'Active Projects', w: 3, h: 1, available: true },
  { type: 'active-workflows', label: 'Active Workflows', w: 3, h: 1, available: true },
  { type: 'decision-list', label: 'Decision List', w: 6, h: 3, available: true },
  { type: 'event-timeline', label: 'Event Timeline', w: 6, h: 2, available: true },
  { type: 'project-switcher', label: 'Project Switcher', w: 4, h: 2, available: true },
  { type: 'cost-chart', label: 'Cost Trend', w: 6, h: 3, available: false },
  { type: 'system-health', label: 'System Health', w: 4, h: 2, available: false },
  { type: 'llm-stats', label: 'LLM Statistics', w: 4, h: 2, available: false },
  { type: 'calendar', label: 'Calendar', w: 4, h: 3, available: false },
  { type: 'clock', label: 'Clock', w: 2, h: 2, available: false },
  { type: 'weather', label: 'Weather', w: 3, h: 2, available: false },
  { type: 'deliverables', label: 'Deliverables', w: 6, h: 3, available: false },
  { type: 'project-list', label: 'Project List', w: 4, h: 3, available: false },
  { type: 'api-switcher', label: 'API Switcher', w: 4, h: 2, available: false },
];

const DEFAULT_LAYOUT = [
  { i: 'pending-decisions', x: 0, y: 0, w: 3, h: 1 },
  { i: 'today-cost', x: 3, y: 0, w: 3, h: 1 },
  { i: 'active-projects', x: 6, y: 0, w: 3, h: 1 },
  { i: 'active-workflows', x: 9, y: 0, w: 3, h: 1 },
  { i: 'decision-list', x: 0, y: 1, w: 6, h: 3 },
  { i: 'event-timeline', x: 6, y: 1, w: 6, h: 2 },
  { i: 'project-switcher', x: 0, y: 4, w: 4, h: 2 },
];

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem('cabinet-office-layout');
    if (raw) return JSON.parse(raw);
    return DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: Layout) {
  localStorage.setItem('cabinet-office-layout', JSON.stringify(layout));
}

function getStatValue(type: WidgetType): { value: string | number; color: string } | null {
  // These will be populated via API in the actual widget render
  return null;
}

export function OfficePage() {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [showPool, setShowPool] = useState(false);
  const [expandedWidget, setExpandedWidget] = useState<string | null>(null);
  const [costDetails, setCostDetails] = useState<{ model: string; cost: number }[]>([]);
  const { projects, current } = useProject();
  const [stats, setStats] = useState({
    pendingDecisions: 0,
    todayCost: 0,
    activeProjects: projects.length,
    activeWorkflows: 0,
  });

  // Fetch stats
  useEffect(() => {
    fetch('/api/dashboard/summary', { headers: { 'x-cabinet-pin': '1234' } })
      .then(res => res.json())
      .then(data => {
        setStats(prev => ({
          ...prev,
          pendingDecisions: data.pendingDecisions ?? 0,
          todayCost: data.todayCost ?? 0,
        }));
      })
      .catch(() => {});
  });

  const handleLayoutChange = useCallback((newLayout: Layout) => {
    setLayout(newLayout.map(item => ({ ...item })));
    saveLayout(newLayout.map(item => ({ ...item })));
  }, []);

  const handleAddWidget = (type: WidgetType) => {
    if (layout.find(item => item.i === type)) return;
    const def = WIDGET_POOL.find(w => w.type === type);
    if (!def) return;
    const newItem = { i: type, x: 0, y: Infinity, w: def.w, h: def.h };
    const updated = [...layout, newItem];
    setLayout(updated);
    saveLayout(updated);
    setShowPool(false);
  };

  const handleRemoveWidget = (type: string) => {
    const updated = layout.filter(item => item.i !== type);
    setLayout(updated);
    saveLayout(updated);
  };

  const handleReset = () => {
    setLayout(DEFAULT_LAYOUT);
    saveLayout(DEFAULT_LAYOUT);
  };

  const addedTypes = new Set(layout.map(item => item.i));

  const navigateTo = (path: string) => {
    window.location.href = path;
  };

  const handleWidgetClick = (type: string) => {
    if (type === 'active-workflows' || type === 'pending-decisions') {
      navigateTo('/factory');
    } else if (type === 'today-cost') {
      // Fetch simulated cost details
      setCostDetails([
        { model: 'claude-sonnet-4-6', cost: 1.23 },
        { model: 'claude-haiku-4-5', cost: 0.45 },
        { model: 'gpt-4o', cost: 0.89 },
      ]);
      setExpandedWidget('today-cost');
    } else if (type === 'active-projects') {
      setExpandedWidget('active-projects');
    } else if (type === 'decision-list') {
      setExpandedWidget('decision-list');
    }
  };

  const renderWidget = (type: string) => {
    switch (type) {
      case 'pending-decisions':
        return <StatCard label="Pending Decisions" value={stats.pendingDecisions} color="text-amber-600" onClick={() => handleWidgetClick('pending-decisions')} />;
      case 'today-cost':
        return <StatCard label="Today's Cost" value={`$${stats.todayCost.toFixed(2)}`} color="text-blue-600" onClick={() => handleWidgetClick('today-cost')} />;
      case 'active-projects':
        return <StatCard label="Active Projects" value={stats.activeProjects} color="text-green-600" onClick={() => handleWidgetClick('active-projects')} />;
      case 'active-workflows':
        return <StatCard label="Workflows" value={stats.activeWorkflows} color="text-purple-600" onClick={() => handleWidgetClick('active-workflows')} />;
      case 'decision-list':
        return <DecisionList />;
      case 'event-timeline':
        return <EventTimeline />;
      case 'project-switcher':
        return <ProjectSwitcherWidget />;
      default: {
        const def = WIDGET_POOL.find(w => w.type === type);
        return <PlaceholderWidget title={def?.label ?? type} />;
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Office</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">Your Decision Room</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPool(!showPool)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2v8M2 6h8" />
            </svg>
            Add Widget
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs rounded-lg border dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Widget pool dropdown */}
      {showPool && (
        <div className="px-6 pb-2">
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-3 grid grid-cols-4 lg:grid-cols-8 gap-2">
            {WIDGET_POOL.filter(w => !addedTypes.has(w.type)).map(w => (
              <button
                key={w.type}
                onClick={() => handleAddWidget(w.type)}
                disabled={!w.available}
                className={`px-2 py-1.5 rounded text-xs text-center transition-colors ${
                  w.available
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-400 line-through cursor-not-allowed'
                }`}
              >
                {w.label}
              </button>
            ))}
            {WIDGET_POOL.every(w => addedTypes.has(w.type)) && (
              <span className="col-span-full text-xs text-gray-400 text-center py-2">
                All widgets added.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Grid layout */}
      <div className="px-6 pb-6">
        {layout.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-center text-gray-400">
            <div>
              <p className="text-lg">No widgets yet</p>
              <p className="text-sm mt-1">Click "Add Widget" to customize your Office.</p>
            </div>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={layout}
            width={(typeof window !== 'undefined' ? window.innerWidth - 200 : 1000)}
            gridConfig={{ cols: 12, rowHeight: 100, margin: [12, 12], containerPadding: null, maxRows: Infinity }}
            dragConfig={{ enabled: true, handle: '.drag-handle', bounded: false }}
            resizeConfig={{ enabled: true }}
            compactor={verticalCompactor}
            onLayoutChange={handleLayoutChange}
          >
            {layout.map(item => (
              <div key={item.i} className="group relative">
                {/* Drag handle + remove button */}
                <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="drag-handle w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <circle cx="2" cy="2" r="1" /><circle cx="7" cy="2" r="1" />
                      <circle cx="2" cy="5" r="1" /><circle cx="7" cy="5" r="1" />
                      <circle cx="2" cy="8" r="1" /><circle cx="7" cy="8" r="1" />
                    </svg>
                  </div>
                  <button
                    onClick={() => handleRemoveWidget(item.i)}
                    className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500"
                  >
                    &times;
                  </button>
                </div>
                {renderWidget(item.i)}
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {/* Expanded overlay */}
      {expandedWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setExpandedWidget(null)}>
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-2xl p-6 w-full max-w-lg m-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {expandedWidget === 'today-cost' ? "Today's Cost Breakdown" : expandedWidget === 'active-projects' ? 'Active Projects' : 'Details'}
              </h3>
              <button onClick={() => setExpandedWidget(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
            </div>

            {expandedWidget === 'today-cost' && (
              <div className="space-y-3">
                <div className="text-2xl font-bold text-blue-600">${stats.todayCost.toFixed(2)}</div>
                <p className="text-xs text-gray-500">Total token consumption cost for today</p>
                <div className="border-t dark:border-gray-700 pt-3 mt-3 space-y-2">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Cost by Model</h4>
                  {costDetails.map(c => (
                    <div key={c.model} className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{c.model}</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">${c.cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 italic mt-2">Detailed cost tracking coming soon.</p>
              </div>
            )}

            {expandedWidget === 'active-projects' && (
              <div className="space-y-3">
                {projects.map(p => (
                  <div key={p.id} className="flex items-center gap-3 border dark:border-gray-700 rounded-lg p-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${p.status === 'active' ? 'bg-green-500' : p.status === 'draft' ? 'bg-amber-500' : 'bg-gray-400'}`} />
                    <div>
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.name}</div>
                      <div className="text-xs text-gray-500">{p.description}</div>
                    </div>
                    <span className="ml-auto text-xs text-gray-400 capitalize">{p.status}</span>
                  </div>
                ))}
              </div>
            )}

            {expandedWidget === 'decision-list' && (
              <DecisionList />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
