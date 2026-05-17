import { AuditTab } from './AuditTab.js';
import { BackupsTab } from './BackupsTab.js';
import { MaintenanceTab } from './MaintenanceTab.js';

export function OthersTab() {
  return (
    <div className="space-y-8">
      <section>
        <AuditTab />
      </section>
      <section className="border-t pt-6 dark:border-gray-700">
        <BackupsTab />
      </section>
      <section className="border-t pt-6 dark:border-gray-700">
        <MaintenanceTab />
      </section>
    </div>
  );
}
