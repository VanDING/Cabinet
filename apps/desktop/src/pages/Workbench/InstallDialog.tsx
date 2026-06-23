import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/api.js';
import { ModalOverlay } from '../../components/ModalOverlay.js';

export function InstallDialog({
  agent,
  method,
  onClose,
  onDone,
}: {
  agent: { id: string; name: string };
  method: { label: string; command: string; checkCommand: string; elevated?: boolean };
  onClose: () => void;
  onDone: () => void;
}) {
  const [output, setOutput] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let buffer = '';
    const run = async () => {
      try {
        const res = await apiFetch('/api/install/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agent.id, method }),
        });
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as {
                  stage?: string;
                  data?: string;
                  error?: string;
                  exitCode?: number;
                };
                const stage = data.stage ?? 'output';
                setOutput((prev) => [...prev, `[${stage}] ${data.data ?? data.error ?? ''}`]);
                if (stage === 'completed') setStatus('completed');
                if (stage === 'failed' || stage === 'error') {
                  setStatus('failed');
                  setErrorMsg(data.error ?? 'Install failed');
                }
              } catch {
                /* partial JSON — skip */
              }
            }
          }
        }
      } catch {
        setStatus('failed');
        setErrorMsg('Network error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [agent.id, method]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' });
  }, [output]);

  return (
    <ModalOverlay
      isOpen={true}
      onClose={() => {
        if (status !== 'running') onClose();
      }}
    >
      <div className="bg-surface-primary w-[500px] rounded-lg p-4 shadow-lg">
        <h3 className="mb-2 font-bold">Installing {agent.name}</h3>
        <p className="text-content-tertiary mb-3 text-xs">
          via {method.label}: {method.command}
        </p>
        <div
          ref={outputRef}
          className="mb-3 max-h-60 overflow-y-auto rounded bg-black/80 p-2 font-mono text-xs text-green-400"
        >
          {output.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {status === 'running' && <div className="animate-pulse">Running...</div>}
          {errorMsg && <div className="text-red-400">{errorMsg}</div>}
        </div>
        <div className="flex justify-end gap-2">
          {status === 'completed' && (
            <button
              onClick={() => {
                onDone();
              }}
              className="bg-accent text-accent-foreground rounded-md px-3 py-1 text-sm"
            >
              Done
            </button>
          )}
          {status === 'failed' && (
            <button onClick={onClose} className="rounded-md border px-3 py-1 text-sm">
              Close
            </button>
          )}
          {status === 'running' && (
            <button onClick={onClose} className="rounded-md border px-3 py-1 text-sm">
              Minimize
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
