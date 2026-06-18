import { WelcomeHeader } from '../components/dashboard/WelcomeHeader.js';
import { ActivityHeatmap } from '../components/dashboard/ActivityHeatmap.js';
import { CostChart } from '../components/office/CostChart.js';
import { KanbanBoard } from '../components/dashboard/KanbanBoard.js';

export function OfficePage() {
  return (
    <div
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '0 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      <WelcomeHeader />

      <div style={{ height: 1, background: 'var(--surface-muted)', margin: '0 32px' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <ActivityHeatmap />
        <div style={{ width: 1, background: 'var(--surface-muted)' }} />
        <CostChart />
      </div>

      <div style={{ height: 1, background: 'var(--surface-muted)', margin: '0 32px' }} />

      <KanbanBoard />
    </div>
  );
}
