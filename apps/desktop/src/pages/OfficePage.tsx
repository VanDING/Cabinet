import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Grip } from 'lucide-react';
import GridLayout, { type Layout, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { StatCard } from '../components/office/StatCard';
import { DecisionList } from '../components/office/DecisionList';
import { DecisionReviewPanel } from '../components/office/DecisionReviewPanel';
import { EventTimeline } from '../components/office/EventTimeline';
import { PlaceholderWidget } from '../components/office/PlaceholderWidget';
import { CostChart } from '../components/office/CostChart';
import { SystemHealth } from '../components/office/SystemHealth';
import { Deliverables } from '../components/office/Deliverables';
import { ProjectList } from '../components/office/ProjectList';
import { ApiSwitcher } from '../components/office/ApiSwitcher';
import { Calendar } from '../components/office/Calendar';
import { Clock } from '../components/office/Clock';
import { Weather } from '../components/office/Weather';
import { ProgressBoard } from '../components/office/ProgressBoard';
import { ObservabilityWidget } from '../components/office/ObservabilityWidget';
import { useToast } from '../components/Toast';
import { apiFetch, authHeaders } from '../utils/pin.js';

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
  | 'agent-health'
  | 'calendar'
  | 'clock'
  | 'weather'
  | 'deliverables'
  | 'project-list'
  | 'api-switcher'
  | 'progress-board';

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
  { type: 'cost-chart', label: 'Cost Trend', w: 6, h: 3, available: true },
  { type: 'system-health', label: 'System Health', w: 4, h: 2, available: true },
  { type: 'llm-stats', label: 'LLM Statistics', w: 4, h: 2, available: true },
  { type: 'agent-health', label: 'Agent Health', w: 4, h: 3, available: true },
  { type: 'calendar', label: 'Calendar', w: 4, h: 3, available: true },
  { type: 'clock', label: 'Clock', w: 2, h: 2, available: true },
  { type: 'weather', label: 'Weather', w: 3, h: 2, available: true },
  { type: 'deliverables', label: 'Deliverables', w: 6, h: 3, available: true },
  { type: 'project-list', label: 'Project List', w: 4, h: 3, available: true },
  { type: 'api-switcher', label: 'API Switcher', w: 4, h: 2, available: true },
  { type: 'progress-board', label: 'Task Board', w: 6, h: 4, available: true },
];

const DEFAULT_LAYOUT = [
  { i: 'pending-decisions', x: 0, y: 0, w: 3, h: 1 },
  { i: 'today-cost', x: 3, y: 0, w: 3, h: 1 },
  { i: 'active-projects', x: 6, y: 0, w: 3, h: 1 },
  { i: 'active-workflows', x: 9, y: 0, w: 3, h: 1 },
  { i: 'decision-list', x: 0, y: 1, w: 6, h: 3 },
  { i: 'event-timeline', x: 6, y: 1, w: 6, h: 2 },
  { i: 'project-switcher', x: 0, y: 4, w: 4, h: 2 },
  { i: 'progress-board', x: 4, y: 4, w: 6, h: 4 },
];

function getLayoutKey(projectId?: string): string {
  return projectId ? `cabinet-project-${projectId}-layout` : 'cabinet-office-layout';
}

function loadLayout(projectId?: string): Layout {
  try {
    const raw = localStorage.getItem(getLayoutKey(projectId));
    if (raw) return JSON.parse(raw);
    return DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: Layout, projectId?: string) {
  localStorage.setItem(getLayoutKey(projectId), JSON.stringify(layout));
}

export function OfficePage() {
  const { id: projectId } = useParams<{ id?: string }>();
  const { addToast } = useToast();
  const [layout, setLayout] = useState<Layout>(() => loadLayout(projectId));
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Reload layout when navigating between Office and Project Dashboard
  useEffect(() => {
    setLayout(loadLayout(projectId));
  }, [projectId]);

  const [containerWidth, setContainerWidth] = useState(1000);
  const [showPool, setShowPool] = useState(false);
  const [reviewDecisionId, setReviewDecisionId] = useState<string | null>(null);
  const [expandedWidget, setExpandedWidget] = useState<string | null>(null);
  const [costDetails, setCostDetails] = useState<{ model: string; cost: number }[]>([]);
  const [stats, setStats] = useState({
    pendingDecisions: 0,
    todayCost: 0,
    activeProjects: 0,
    activeWorkflows: 0,
  });

  // Keep grid width in sync with actual container element (handles sidebar collapse, mobile, etc.)
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const refreshStats = useCallback(() => {
    const url = projectId
      ? `/api/dashboard/summary?projectId=${projectId}`
      : '/api/dashboard/summary';
    apiFetch(url, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setStats({
          pendingDecisions: data.pendingDecisions ?? 0,
          todayCost: data.todayCost ?? 0,
          activeProjects: data.activeProjects ?? 0,
          activeWorkflows: data.activeWorkflows ?? 0,
        });
      })
      .catch(() => {
        addToast('error', 'Failed to load dashboard stats');
      });
  }, [addToast, projectId]);

  // Initial data fetch
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Listen for WebSocket decision updates
  useEffect(() => {
    window.addEventListener('ws:decision_created', refreshStats);
    window.addEventListener('ws:decision_updated', refreshStats);
    return () => {
      window.removeEventListener('ws:decision_created', refreshStats);
      window.removeEventListener('ws:decision_updated', refreshStats);
    };
  }, [refreshStats]);

  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleLayoutChange = useCallback((newLayout: Layout) => {
    const cloned = newLayout.map((item) => ({ ...item }));
    setLayout(cloned);
    clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => saveLayout(cloned, projectId), 300);
  }, [projectId]);

  const handleAddWidget = (type: WidgetType) => {
    if (layout.find((item) => item.i === type)) return;
    const def = WIDGET_POOL.find((w) => w.type === type);
    if (!def) return;
    const newItem = { i: type, x: 0, y: Infinity, w: def.w, h: def.h };
    const updated = [...layout, newItem];
    setLayout(updated);
    saveLayout(updated, projectId);
    setShowPool(false);
  };

  const handleRemoveWidget = (type: string) => {
    const updated = layout.filter((item) => item.i !== type);
    setLayout(updated);
    saveLayout(updated, projectId);
  };

  const handleReset = () => {
    setLayout(DEFAULT_LAYOUT);
    saveLayout(DEFAULT_LAYOUT, projectId);
  };

  const addedTypes = new Set(layout.map((item) => item.i));

  const handleWidgetClick = (type: string) => {
    if (type === 'today-cost') {
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
        return (
          <StatCard
            label="Pending Decisions"
            value={stats.pendingDecisions}
            color="text-amber-600"
            onClick={() => {
              if (stats.pendingDecisions > 0) {
                // Open the first pending decision
                apiFetch(`/api/decisions?status=pending${projectId ? `&projectId=${projectId}` : ''}`, { headers: authHeaders() })
                  .then((r) => r.json())
                  .then((data) => {
                    if (data.decisions?.[0]) setReviewDecisionId(data.decisions[0].id);
                  })
                  .catch(() => {});
              }
            }}
          />
        );
      case 'today-cost':
        return (
          <StatCard
            label="Today's Cost"
            value={`$${stats.todayCost.toFixed(2)}`}
            color="text-blue-600"
            onClick={() => handleWidgetClick('today-cost')}
          />
        );
      case 'active-projects':
        return (
          <StatCard
            label="Active Projects"
            value={stats.activeProjects}
            color="text-green-600"
            onClick={() => handleWidgetClick('active-projects')}
          />
        );
      case 'active-workflows':
        return <StatCard label="Workflows" value={stats.activeWorkflows} color="text-purple-600" />;
      case 'decision-list':
        return <DecisionList onSelectDecision={(id) => setReviewDecisionId(id)} />;
      case 'event-timeline':
        return <EventTimeline />;
      case 'project-switcher':
        return <PlaceholderWidget title="Project Switcher" />;
      case 'cost-chart':
        return <CostChart />;
      case 'system-health':
        return <SystemHealth />;
      case 'llm-stats':
        return <SystemHealth />;
      case 'agent-health':
        return <ObservabilityWidget />;
      case 'deliverables':
        return <Deliverables />;
      case 'project-list':
        return <ProjectList />;
      case 'api-switcher':
        return <ApiSwitcher />;
      case 'progress-board':
        return <ProgressBoard />;
      case 'calendar':
        return <Calendar />;
      case 'clock':
        return <Clock />;
      case 'weather':
        return <Weather />;
      default: {
        const def = WIDGET_POOL.find((w) => w.type === type);
        return <PlaceholderWidget title={def?.label ?? type} />;
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pb-2 pt-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {projectId ? 'Project Dashboard' : 'Office'}
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {projectId ? `Project #${projectId}` : 'Your Decision Room'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPool(!showPool)}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={12} />
            Add Widget
          </button>
          <button
            onClick={handleReset}
            className="rounded-lg border px-3 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Widget pool dropdown */}
      {showPool && (
        <div className="px-6 pb-2">
          <div className="grid grid-cols-4 gap-2 rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800 lg:grid-cols-8">
            {WIDGET_POOL.filter((w) => !addedTypes.has(w.type)).map((w) => (
              <button
                key={w.type}
                onClick={() => handleAddWidget(w.type)}
                disabled={!w.available}
                className={`rounded px-2 py-1.5 text-center text-xs transition-colors ${
                  w.available
                    ? 'bg-gray-100 text-gray-700 hover:bg-blue-100 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-blue-900/30'
                    : 'cursor-not-allowed bg-gray-50 text-gray-400 line-through dark:bg-gray-800'
                }`}
              >
                {w.label}
              </button>
            ))}
            {WIDGET_POOL.every((w) => addedTypes.has(w.type)) && (
              <span className="col-span-full py-2 text-center text-xs text-gray-400">
                All widgets added.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Grid layout */}
      <div ref={gridContainerRef} className="px-6 pb-6">
        {layout.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-center text-gray-400">
            <div>
              <p className="text-lg">No widgets yet</p>
              <p className="mt-1 text-sm">Click "Add Widget" to customize your Office.</p>
            </div>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={layout}
            width={containerWidth}
            gridConfig={{
              cols: 12,
              rowHeight: 100,
              margin: [12, 12],
              containerPadding: null,
              maxRows: Infinity,
            }}
            dragConfig={{ enabled: true, handle: '.drag-handle', bounded: false }}
            resizeConfig={{ enabled: true }}
            compactor={verticalCompactor}
            onLayoutChange={handleLayoutChange}
          >
            {layout.map((item) => (
              <div key={item.i} className="group relative">
                {/* Drag handle + remove button */}
                <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="drag-handle flex h-5 w-5 cursor-grab items-center justify-center rounded text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:hover:text-gray-200">
                    <Grip size={12} />
                  </div>
                  <button
                    onClick={() => handleRemoveWidget(item.i)}
                    className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-red-500"
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setExpandedWidget(null)}
        >
          <div
            className="m-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {expandedWidget === 'today-cost'
                  ? "Today's Cost Breakdown"
                  : expandedWidget === 'active-projects'
                    ? 'Active Projects'
                    : 'Details'}
              </h3>
              <button
                onClick={() => setExpandedWidget(null)}
                className="text-xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                &times;
              </button>
            </div>

            {expandedWidget === 'today-cost' && (
              <div className="space-y-3">
                <div className="text-2xl font-bold text-blue-600">
                  ${stats.todayCost.toFixed(2)}
                </div>
                <p className="text-xs text-gray-500">Total token consumption cost for today</p>
                <div className="mt-3 space-y-2 border-t pt-3 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Cost by Model
                  </h4>
                  {costDetails.map((c) => (
                    <div key={c.model} className="flex justify-between text-sm">
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                        {c.model}
                      </span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        ${c.cost.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs italic text-gray-400">
                  Detailed cost tracking coming soon.
                </p>
              </div>
            )}

            {expandedWidget === 'active-projects' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Project list managed from sidebar.</p>
                <p className="mt-2 text-xs italic text-gray-400">
                  Full project management coming soon.
                </p>
              </div>
            )}

            {expandedWidget === 'decision-list' && (
              <DecisionList
                onSelectDecision={(id) => {
                  setReviewDecisionId(id);
                  setExpandedWidget(null);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Decision Review Panel */}
      {reviewDecisionId && (
        <DecisionReviewPanel
          decisionId={reviewDecisionId}
          onClose={() => setReviewDecisionId(null)}
          onResolved={refreshStats}
        />
      )}
    </div>
  );
}
