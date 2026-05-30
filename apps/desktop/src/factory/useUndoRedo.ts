import { useCallback, useRef, useState } from 'react';
import type { CanvasNode, CanvasEdge } from './node-types';

interface Snapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface UseUndoRedoOptions {
  maxHistory?: number;
}

export function useUndoRedo({ maxHistory = 50 }: UseUndoRedoOptions = {}) {
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const skipNext = useRef(false);
  const [, setTick] = useState(0);

  const record = useCallback(
    (nodes: CanvasNode[], edges: CanvasEdge[]) => {
      if (skipNext.current) {
        skipNext.current = false;
        return;
      }
      undoStack.current.push({
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      });
      if (undoStack.current.length > maxHistory) {
        undoStack.current.shift();
      }
      redoStack.current = [];
      setTick((t) => t + 1);
    },
    [maxHistory],
  );

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setTick((t) => t + 1);
  }, []);

  const undo = useCallback(
    (
      current: { nodes: CanvasNode[]; edges: CanvasEdge[] },
      apply: (nodes: CanvasNode[], edges: CanvasEdge[]) => void,
    ) => {
      const prev = undoStack.current.pop();
      if (!prev) return;
      redoStack.current.push({
        nodes: JSON.parse(JSON.stringify(current.nodes)),
        edges: JSON.parse(JSON.stringify(current.edges)),
      });
      skipNext.current = true;
      apply(prev.nodes, prev.edges);
    },
    [],
  );

  const redo = useCallback(
    (
      current: { nodes: CanvasNode[]; edges: CanvasEdge[] },
      apply: (nodes: CanvasNode[], edges: CanvasEdge[]) => void,
    ) => {
      const next = redoStack.current.pop();
      if (!next) return;
      undoStack.current.push({
        nodes: JSON.parse(JSON.stringify(current.nodes)),
        edges: JSON.parse(JSON.stringify(current.edges)),
      });
      skipNext.current = true;
      apply(next.nodes, next.edges);
    },
    [],
  );

  return {
    record,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undoSize: undoStack.current.length,
    redoSize: redoStack.current.length,
  };
}
