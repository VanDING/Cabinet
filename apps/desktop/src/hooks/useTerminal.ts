import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface UseTerminalOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  onOutput?: (data: string) => void;
  onExit?: (code: number | null) => void;
  enabled: boolean;
}

export function useTerminal(opts: UseTerminalOptions) {
  const ptyIdRef = useRef<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [cols, setCols] = useState(80);
  const [rows, setRows] = useState(24);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const commandKey = `${opts.command} ${opts.args.join(' ')}`;

  useEffect(() => {
    if (!opts.enabled) return;
    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    (async () => {
      try {
        const ptyId = await invoke<string>('pty_spawn', {
          agentId: `terminal_${Date.now()}`,
          command: opts.command,
          args: opts.args,
          env: opts.env ?? {},
        });
        ptyIdRef.current = ptyId;
        setIsRunning(true);

        unlistenData = await listen<{ ptyId: string; data: string }>('pty:data', (event) => {
          if (event.payload.ptyId === ptyId) {
            optsRef.current.onOutput?.(event.payload.data);
          }
        });
        unlistenExit = await listen<{ ptyId: string; exitCode: number | null }>(
          'pty:exit',
          (event) => {
            if (event.payload.ptyId === ptyId) {
              setIsRunning(false);
              optsRef.current.onExit?.(event.payload.exitCode);
            }
          },
        );
      } catch (err) {
        console.error('Failed to spawn PTY:', err);
        setIsRunning(false);
      }
    })();

    return () => {
      unlistenData?.();
      unlistenExit?.();
      if (ptyIdRef.current) {
        invoke('pty_kill', { ptyId: ptyIdRef.current }).catch(() => {});
        ptyIdRef.current = null;
        setIsRunning(false);
      }
    };
  }, [commandKey, opts.enabled]);

  const write = useCallback(async (data: string) => {
    if (ptyIdRef.current) {
      try {
        await invoke('pty_write', { ptyId: ptyIdRef.current, data });
      } catch (err) {
        console.error('Failed to write to PTY:', err);
      }
    }
  }, []);

  const resize = useCallback(async (c: number, r: number) => {
    setCols(c);
    setRows(r);
    if (ptyIdRef.current) {
      try {
        await invoke('pty_resize', { ptyId: ptyIdRef.current, cols: c, rows: r });
      } catch (err) {
        console.error('Failed to resize PTY:', err);
      }
    }
  }, []);

  return { isRunning, cols, rows, write, resize };
}
