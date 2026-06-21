import { AuditTab } from './AuditTab.js';
import { BackupsTab } from './BackupsTab.js';
import { MaintenanceTab } from './MaintenanceTab.js';

export function OthersTab() {
  return (
    <div className="space-y-8">
      <section>
        <MaintenanceTab />
      </section>
      <section className="border-border border-t pt-6">
        <BackupsTab />
      </section>
      <section className="border-border border-t pt-6">
        <AuditTab />
      </section>
    </div>
  );
}
