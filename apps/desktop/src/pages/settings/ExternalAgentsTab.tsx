export function ExternalAgentsTab() {
  return (
    <div className="space-y-4">
      <p className="text-content-tertiary text-sm">
        External agent management has moved to the Employees page.
      </p>
      <a
        href="/employees"
        className="bg-accent text-content-inverse hover:bg-accent-hover inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
      >
        Go to Employees
      </a>
    </div>
  );
}
