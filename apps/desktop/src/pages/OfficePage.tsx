import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Grip } from 'lucide-react';
import { Button, Card } from '@cabinet/ui';
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
import { DeliverablesPanel } from '../components/office/DeliverablesPanel';
import { CostOverviewModal } from '../components/office/CostOverviewModal';
import { ActiveWorkflowsModal } from '../components/office/ActiveWorkflowsModal';
import { EventTimelineModal } from '../components/office/EventTimelineModal';
import { WeatherForecastModal } from '../components/office/WeatherForecastModal';
import { DeliverablesModal } from '../components/office/DeliverablesModal';
import { InsightsWidget } from '../components/office/InsightsWidget';
import { TelemetryWidget } from '../components/office/TelemetryWidget';
import { AgentMonitor } from '../components/office/AgentMonitor';
import { ActivityFeed } from '../components/ActivityFeed';
import { InsightsModal } from '../components/office/InsightsModal';
import { HarnessWidget } from '../components/office/HarnessWidget';
import { HarnessModal } from '../components/office/HarnessModal';
import { useToast } from '../components/Toast';
import { ModalOverlay } from '../components/ModalOverlay';
import { apiFetch, authHeaders } from '../utils/api.js';

type WidgetType =
  | 'today-cost'
  | 'active-workflows'
  | 'decision-list'
  | 'event-timeline'
  | 'cost-chart'
  | 'system-health'
  | 'calendar'
  | 'clock'
  | 'weather'
  | 'deliverables'
  | 'project-list'
  | 'api-switcher'
  | 'progress-board'
  | 'meeting-list'
  | 'insights'
  | 'harness'
  | 'telemetry-dashboard'
  | 'activity-feed'
  | 'agent-monitor';

interface WidgetDef {
  type: WidgetType;
  label: string;
  w: number;
  h: number;
  available: boolean;
}

const WIDGET_POOL: WidgetDef[] = [
  { type: 'today-cost', label: "Today's Cost", w: 6, h: 2, available: true },
  { type: 'active-workflows', label: 'Active Workflows', w: 6, h: 2, available: true },
  { type: 'decision-list', label: 'Decision List', w: 12, h: 5, available: true },
  { type: 'event-timeline', label: 'Event Timeline', w: 12, h: 3, available: true },
  { type: 'cost-chart', label: 'Cost Trend', w: 12, h: 5, available: true },
  { type: 'system-health', label: 'System Health', w: 8, h: 3, available: true },
  { type: 'calendar', label: 'Calendar', w: 8, h: 5, available: true },
  { type: 'clock', label: 'Clock', w: 4, h: 3, available: true },
  { type: 'weather', label: 'Weather', w: 6, h: 3, available: true },
  { type: 'deliverables', label: 'Deliverables', w: 12, h: 5, available: true },
  { type: 'project-list', label: 'Project List', w: 8, h: 5, available: true },
  { type: 'api-switcher', label: 'API Switcher', w: 8, h: 3, available: true },
  { type: 'progress-board', label: 'Task Board', w: 12, h: 7, available: true },
  { type: 'meeting-list', label: 'Meetings', w: 8, h: 5, available: true },
  { type: 'insights', label: 'Insights', w: 8, h: 5, available: true },
  { type: 'harness', label: 'Harness', w: 8, h: 5, available: true },
  { type: 'telemetry-dashboard', label: 'Telemetry', w: 12, h: 8, available: true },
  { type: 'activity-feed', label: 'Activity Feed', w: 8, h: 6, available: true },
  { type: 'agent-monitor', label: 'Agent Monitor', w: 24, h: 12, available: true },
];

const DEFAULT_LAYOUT = [
  { i: 'today-cost', x: 0, y: 0, w: 3, h: 1 },
  { i: 'active-workflows', x: 3, y: 0, w: 3, h: 1 },
  { i: 'decision-list', x: 0, y: 1, w: 6, h: 3 },
  { i: 'event-timeline', x: 6, y: 1, w: 6, h: 2 },
  { i: 'deliverables', x: 0, y: 3, w: 6, h: 3 },
  { i: 'progress-board', x: 0, y: 4, w: 6, h: 4 },
  { i: 'insights', x: 6, y: 4, w: 4, h: 3 },
  { i: 'harness', x: 0, y: 7, w: 4, h: 3 },
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
  const [stats, setStats] = useState({
    todayCost: 0,
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
          todayCost: data.todayCost ?? 0,
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

  // Listen for WebSocket event updates
  useEffect(() => {
    window.addEventListener('ws:project_created', refreshStats);
    window.addEventListener('ws:project_updated', refreshStats);
    window.addEventListener('ws:project_deleted', refreshStats);
    window.addEventListener('ws:workflow_started', refreshStats);
    window.addEventListener('ws:workflow_completed', refreshStats);
    window.addEventListener('ws:cost_updated', refreshStats);
    window.addEventListener('ws:task_updated', refreshStats);
    window.addEventListener('ws:task_executed', refreshStats);
    return () => {
      window.removeEventListener('ws:project_created', refreshStats);
      window.removeEventListener('ws:project_updated', refreshStats);
      window.removeEventListener('ws:project_deleted', refreshStats);
      window.removeEventListener('ws:workflow_started', refreshStats);
      window.removeEventListener('ws:workflow_completed', refreshStats);
      window.removeEventListener('ws:cost_updated', refreshStats);
      window.removeEventListener('ws:task_updated', refreshStats);
      window.removeEventListener('ws:task_executed', refreshStats);
    };
  }, [refreshStats]);

  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      const cloned = newLayout.map((item) => ({ ...item }));
      setLayout(cloned);
      clearTimeout(layoutSaveTimer.current);
      layoutSaveTimer.current = setTimeout(() => saveLayout(cloned, projectId), 300);
    },
    [projectId],
  );

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
      setExpandedWidget('today-cost');
    } else if (type === 'active-workflows') {
      setExpandedWidget('active-workflows');
    } else if (type === 'event-timeline') {
      setExpandedWidget('event-timeline');
    } else if (type === 'deliverables') {
      setExpandedWidget('deliverables');
    } else if (type === 'insights') {
      setExpandedWidget('insights');
    } else if (type === 'harness') {
      setExpandedWidget('harness');
    } else if (type === 'weather') {
      setExpandedWidget('weather');
    } else if (type === 'decision-list') {
      setExpandedWidget('decision-list');
    }
  };

  const renderWidget = (type: string) => {
    switch (type) {
      case 'today-cost':
        return (
          <StatCard
            label="Today's Cost"
            value={`${stats.todayCost.toFixed(2)}`}
            color="text-accent"
            onClick={() => handleWidgetClick('today-cost')}
          />
        );
      case 'active-workflows':
        return (
          <StatCard
            label="Workflows"
            value={stats.activeWorkflows}
            color="text-accent"
            onClick={() => handleWidgetClick('active-workflows')}
          />
        );
      case 'decision-list':
        return (
          <DecisionList onSelectDecision={(id) => setReviewDecisionId(id)} projectId={projectId} />
        );
      case 'event-timeline':
        return (
          <EventTimeline
            projectId={projectId}
            onExpand={() => handleWidgetClick('event-timeline')}
          />
        );
      case 'cost-chart':
        return <CostChart />;
      case 'system-health':
        return <SystemHealth />;
      case 'deliverables':
        return (
          <Deliverables projectId={projectId} onExpand={() => handleWidgetClick('deliverables')} />
        );
      case 'project-list':
        return <ProjectList />;
      case 'api-switcher':
        return <ApiSwitcher />;
      case 'progress-board':
        return <ProgressBoard projectId={projectId} />;
      case 'meeting-list':
        return <div className="text-muted p-4">Meeting feature removed</div>;
      case 'insights':
        return <InsightsWidget onExpand={() => handleWidgetClick('insights')} />;
      case 'harness':
        return <HarnessWidget onExpand={() => handleWidgetClick('harness')} />;
      case 'telemetry-dashboard':
        return <TelemetryWidget />;
      case 'activity-feed':
        return <ActivityFeed />;
      case 'agent-monitor':
        return <AgentMonitor />;
      case 'calendar':
        return <Calendar />;
      case 'clock':
        return <Clock />;
      case 'weather':
        return <Weather onExpand={() => handleWidgetClick('weather')} />;
      default: {
        const def = WIDGET_POOL.find((w) => w.type === type);
        return <PlaceholderWidget title={def?.label ?? type} />;
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-4 pb-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-content-primary text-2xl font-bold">
            {projectId ? 'Project Dashboard' : 'Office'}
          </h1>
          <span className="text-content-tertiary text-sm">
            {projectId ? `Project #${projectId}` : 'Your Decision Room'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="xs" onClick={() => setShowPool(!showPool)}>
            <Plus size={12} />
            Add Widget
          </Button>
          <Button variant="ghost" size="xs" onClick={handleReset}>
            Reset
          </Button>
        </div>
      </div>

      {/* Widget pool dropdown */}
      {showPool && (
        <div className="px-6 pb-2">
          <div className="border-border bg-surface-primary grid grid-cols-4 gap-2 rounded-lg border p-3 shadow-xs lg:grid-cols-8">
            {WIDGET_POOL.filter((w) => !addedTypes.has(w.type)).map((w) => (
              <button
                key={w.type}
                onClick={() => handleAddWidget(w.type)}
                disabled={!w.available}
                className={`rounded px-2 py-1.5 text-center text-xs transition-colors ${
                  w.available
                    ? 'bg-surface-muted text-content-secondary hover:bg-accent-muted:bg-accent-hover/30'
                    : 'bg-surface-elevated text-content-tertiary cursor-not-allowed line-through'
                }`}
              >
                {w.label}
              </button>
            ))}
            {WIDGET_POOL.every((w) => addedTypes.has(w.type)) && (
              <span className="text-content-tertiary col-span-full py-2 text-center text-xs">
                All widgets added.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Grid layout */}
      <div ref={gridContainerRef} className="px-6 pb-6">
        {layout.length === 0 ? (
          <div className="text-content-tertiary flex items-center justify-center py-24 text-center">
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
              cols: 24,
              rowHeight: 60,
              margin: [12, 12],
              containerPadding: null,
              maxRows: Infinity,
            }}
            dragConfig={{ enabled: true, handle: '.drag-handle', bounded: false }}
            resizeConfig={{ enabled: true }}
            compactor={verticalCompactor}
            onLayoutChange={handleLayoutChange}
          >
            {layout.map((item) => {
              const interactiveTypes = [
                'today-cost',
                'active-workflows',
                'event-timeline',
                'deliverables',
                'insights',
                'harness',
                'weather',
                'decision-list',
              ];
              const isInteractive = interactiveTypes.includes(item.i);
              return (
                <div
                  key={item.i}
                  className={`group relative h-full rounded-xl ${isInteractive ? 'widget-interactive' : 'widget-static'}`}
                >
                  {/* Drag handle + remove button */}
                  <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="drag-handle text-content-tertiary hover:text-content-secondary active:cursor-grabbing:text-content-tertiary flex h-5 w-5 cursor-grab items-center justify-center rounded-sm">
                      <Grip size={12} />
                    </div>
                    <button
                      onClick={() => handleRemoveWidget(item.i)}
                      className="text-content-tertiary hover:text-intent-danger flex h-5 w-5 items-center justify-center rounded-sm"
                    >
                      &times;
                    </button>
                  </div>
                  {renderWidget(item.i)}
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      {/* Expanded overlay */}
      {expandedWidget === 'today-cost' && (
        <CostOverviewModal onClose={() => setExpandedWidget(null)} />
      )}
      {expandedWidget === 'active-workflows' && (
        <ActiveWorkflowsModal onClose={() => setExpandedWidget(null)} />
      )}
      {expandedWidget === 'event-timeline' && (
        <EventTimelineModal onClose={() => setExpandedWidget(null)} projectId={projectId} />
      )}
      {expandedWidget === 'weather' && (
        <WeatherForecastModal onClose={() => setExpandedWidget(null)} />
      )}
      {expandedWidget === 'deliverables' && (
        <DeliverablesModal onClose={() => setExpandedWidget(null)} projectId={projectId} />
      )}
      {expandedWidget === 'insights' && <InsightsModal onClose={() => setExpandedWidget(null)} />}
      {expandedWidget === 'harness' && <HarnessModal onClose={() => setExpandedWidget(null)} />}
      {expandedWidget &&
        expandedWidget !== 'today-cost' &&
        expandedWidget !== 'active-workflows' &&
        expandedWidget !== 'event-timeline' &&
        expandedWidget !== 'weather' &&
        expandedWidget !== 'deliverables' &&
        expandedWidget !== 'insights' &&
        expandedWidget !== 'harness' && (
          <ModalOverlay
            isOpen={true}
            onClose={() => setExpandedWidget(null)}
            contentClassName="m-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface-overlay p-6 shadow-lg"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-content-primary text-lg font-semibold">{'Details'}</h3>
              <button
                onClick={() => setExpandedWidget(null)}
                className="text-content-tertiary hover:text-content-secondary text-xl leading-none"
              >
                &times;
              </button>
            </div>

            {expandedWidget === 'decision-list' && (
              <DecisionList
                projectId={projectId}
                onSelectDecision={(id) => {
                  setReviewDecisionId(id);
                  setExpandedWidget(null);
                }}
              />
            )}
          </ModalOverlay>
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
