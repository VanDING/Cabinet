import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTerminal } from '../../hooks/useTerminal';

interface TerminalTabProps {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  onClose: () => void;
}

export function TerminalTab({ label, command, args, env, onClose }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const termRef = useRef<{
    write: (d: string) => Promise<void>;
    resize: (c: number, r: number) => Promise<void>;
  } | null>(null);
  const [ready, setReady] = useState(false);

  const { write, resize, isRunning } = useTerminal({
    command,
    args,
    env,
    enabled: ready,
    onOutput: (data) => xtermRef.current?.write(data),
  });

  termRef.current = { write, resize };

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontSize: 12,
      fontFamily: 'Menlo, Consolas, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    xtermRef.current = term;

    term.onData((data) => termRef.current?.write(data));

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        termRef.current?.resize(term.cols, term.rows);
      } catch {
        // ignore
      }
    });
    ro.observe(containerRef.current);

    setReady(true);
    term.focus();

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-surface-muted flex shrink-0 items-center justify-between border-b px-3 py-1">
        <span className="text-content-secondary text-xs">
          {label}{' '}
          {isRunning ? (
            <span className="text-intent-success">●</span>
          ) : (
            <span className="text-content-tertiary">○</span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-primary text-xs"
          aria-label="Close terminal"
        >
          ✕
        </button>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
