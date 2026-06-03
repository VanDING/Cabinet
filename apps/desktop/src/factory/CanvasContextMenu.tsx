import { useEffect, useRef } from 'react';
import { CANVAS_NODE_TYPES, NODE_LABELS, type CanvasNodeType } from './node-types';

export interface ContextMenuState {
  x: number;
  y: number;
  flowPosition: { x: number; y: number };
  nodeId?: string | null;
  edgeId?: string;
  nodeType?: CanvasNodeType;
  selectedNodeIds?: string[];
}

interface Props {
  state: ContextMenuState;
  onAction: (action: string) => void;
  onClose: () => void;
}

export function CanvasContextMenu({ state, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const itemClass =
    'px-3 py-1.5 text-xs text-content-primary hover:bg-accent-muted cursor-pointer whitespace-nowrap transition-colors';
  const separatorClass = 'border-t border-border my-0.5';

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(state.x, window.innerWidth - 200),
    top: Math.min(state.y, window.innerHeight - 400),
    zIndex: 1000,
  };

  const sendAction = (action: string) => {
    onAction(action);
    onClose();
  };

  return (
    <div
      ref={ref}
      style={style}
      className="rounded-lg border border-border bg-surface-overlay shadow-lg py-1 min-w-[160px]"
    >
      {/* On node */}
      {state.nodeId && (
        <>
          <div className="px-3 py-1 text-[10px] text-content-tertiary uppercase">
            Node: {state.nodeId.slice(0, 12)}…
          </div>
          <div className={separatorClass} />
          {(state.selectedNodeIds?.length ?? 0) > 1 && (
            <>
              <div className={itemClass} onClick={() => sendAction('group-into-agent')}>
                Group into Agent ({state.selectedNodeIds!.length})
              </div>
              <div className={separatorClass} />
            </>
          )}
          <div className={itemClass} onClick={() => sendAction('duplicate-node')}>
            Duplicate
          </div>
          <div className={itemClass} onClick={() => sendAction('delete-node')}>
            Delete
          </div>
        </>
      )}

      {/* On edge */}
      {state.edgeId && !state.nodeId && (
        <>
          <div className="px-3 py-1 text-[10px] text-content-tertiary uppercase">
            Edge
          </div>
          <div className={separatorClass} />
          <div className={itemClass} onClick={() => sendAction('delete-edge')}>
            Delete Edge
          </div>
        </>
      )}

      {/* On pane (no node or edge) */}
      {!state.nodeId && !state.edgeId && (
        <>
          <div className="px-3 py-1 text-[10px] text-content-tertiary uppercase">
            Add Node
          </div>
          <div className={separatorClass} />
          {CANVAS_NODE_TYPES.map((type) => (
            <div
              key={type}
              className={itemClass}
              onClick={() => {
                onAction('add-node');
                // Store type in state for the action handler
                state.nodeType = type;
              }}
            >
              + {NODE_LABELS[type]}
            </div>
          ))}
          <div className={separatorClass} />
          <div className={itemClass} onClick={() => sendAction('group-into-agent')}>
            Group into Agent
          </div>
          <div className={separatorClass} />
          <div className={itemClass} onClick={() => sendAction('fit-view')}>
            Fit to View
          </div>
        </>
      )}
    </div>
  );
}
