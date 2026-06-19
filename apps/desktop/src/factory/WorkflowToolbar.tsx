import { Button } from '@cabinet/ui';

export interface WorkflowToolbarProps {
  name: string;
  status: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onChatEdit: () => void;
  onDelete: () => void;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        status === 'running'
          ? 'bg-accent-muted text-accent'
          : status === 'completed'
            ? 'bg-intent-success-muted text-intent-success'
            : status === 'failed'
              ? 'bg-intent-danger-muted text-intent-danger'
              : 'bg-surface-muted text-content-secondary'
      }`}
    >
      {status}
    </span>
  );
}

export function WorkflowToolbar({
  name,
  status,
  dirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onChatEdit,
  onDelete,
}: WorkflowToolbarProps) {
  return (
    <div className="border-border flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-2">
        <h2 className="text-content-primary text-sm font-semibold">{name}</h2>
        <StatusBadge status={status} />
        {dirty && (
          <span className="bg-intent-warning-muted text-intent-warning rounded-sm px-1.5 py-0.5 text-[10px]">
            Unsaved
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="text-content-tertiary hover:text-content-primary rounded-sm p-1 text-xs disabled:opacity-30"
        >
          ↩
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className="text-content-tertiary hover:text-content-primary rounded-sm p-1 text-xs disabled:opacity-30"
        >
          ↪
        </button>
        <Button size="xs" variant="ghost" onClick={onSave} disabled={!dirty}>
          Save
        </Button>
        <Button size="xs" variant="ghost" onClick={onChatEdit}>
          Chat Edit
        </Button>
        <Button size="xs" variant="ghost" className="text-intent-danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
