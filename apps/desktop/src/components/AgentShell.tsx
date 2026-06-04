//
// AgentShell — embedded terminal for direct CLI agent interaction.
//
// Uses xterm.js for terminal rendering and Tauri PTY for process I/O.
// Provides agent switching, deliverable extraction, Slot writing, and
// command interception via Cabinet's DecisionService.
//

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

// ── Types ────────────────────────────────────────────────────────

interface AgentShellProps {
  /** Initially selected agent ID. */
  agentId?: string;
  /** Called when the shell is closed. */
  onClose?: () => void;
  /** Available CLI agents (from AgentRoleRegistry). */
  agents?: Array<{ id: string; name: string; command: string; args: string[] }>;
  /** Session ID if launched from a task context. */
  sessionId?: string;
  /** Task ID if launched from a task context. */
  taskId?: string;
}

interface AgentInfo {
  tokens: number;
  ttftMs: number;
  model: string;
}

// ── Component ────────────────────────────────────────────────────

export const AgentShell: React.FC<AgentShellProps> = ({
  agentId: initialAgentId,
  onClose,
  agents = [],
  sessionId,
  taskId,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    initialAgentId ?? agents[0]?.id ?? '',
  );
  const [agentInfo, setAgentInfo] = useState<AgentInfo>({ tokens: 0, ttftMs: 0, model: '' });
  const [isRunning, setIsRunning] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // ── Initialize xterm.js terminal ──────────────────────────────

  useEffect(() => {
    if (!terminalRef.current) return;

    // Dynamic import — xterm.js is a large dependency
    const initTerminal = async () => {
      try {
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('xterm-addon-fit');

        const term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
          theme: {
            background: '#1a1a2e',
            foreground: '#e0e0e0',
            cursor: '#00ff88',
            selectionBackground: '#334155',
          },
          allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current!);
        fitAddon.fit();

        // ── Selection tracking for deliverable/Slot extraction ──
        term.onSelectionChange(() => {
          const selection = term.getSelection();
          setSelectedText(selection || '');
        });

        // ── Keyboard input → IPC → PTY ──
        term.onData(async (data: string) => {
          // Command interception: check for high-risk patterns before sending
          if (await checkHighRiskCommand(data)) {
            term.write('\r\n\x1b[31m[BLOCKED] Command requires Captain approval.\x1b[0m\r\n');
            return;
          }
          // Send to PTY via Tauri IPC
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('pty_write', { agentId: selectedAgentId, data });
          } catch {
            // PTY may not be available (dev mode) — echo locally
            term.write(data);
          }
        });

        // Store terminal instance for cleanup
        (terminalRef.current as any)._term = term;
        setIsRunning(true);
      } catch {
        // xterm.js not installed — fallback to plain textarea
        setStatusMessage('xterm.js not available — install with: npm install xterm xterm-addon-fit');
      }
    };

    initTerminal();

    return () => {
      const el = terminalRef.current;
      if (el && (el as any)._term) {
        (el as any)._term.dispose();
      }
    };
  }, [selectedAgentId]);

  // ── Resize on window change ───────────────────────────────────

  useEffect(() => {
    const onResize = () => {
      const el = terminalRef.current;
      if (el && (el as any)._term) {
        try {
          const { FitAddon } = require('xterm-addon-fit');
          // FitAddon is already loaded; resize handled by fit addon
        } catch { /* noop */ }
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Actions ───────────────────────────────────────────────────

  const handleSubmitDeliverable = useCallback(async () => {
    if (!selectedText || !taskId) return;
    try {
      const resp = await apiFetch('/api/external/deliverables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: selectedAgentId,
          task_id: taskId,
          title: `Terminal output — ${new Date().toLocaleTimeString()}`,
          type: 'terminal_output',
          content: selectedText,
        }),
      });
      if (resp.ok) {
        setStatusMessage('Deliverable submitted ✓');
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (err) {
      setStatusMessage(`Failed: ${String(err)}`);
    }
  }, [selectedText, selectedAgentId, taskId]);

  const handleWriteToSlot = useCallback(async () => {
    if (!selectedText || !taskId) return;
    try {
      const resp = await fetch(`/api/slot/${taskId}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discoveries: [{ type: 'terminal_selection', summary: selectedText.slice(0, 500) }],
        }),
      });
      if (resp.ok) {
        setStatusMessage('Written to Slot ✓');
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (err) {
      setStatusMessage(`Failed: ${String(err)}`);
    }
  }, [selectedText, taskId]);

  const handleSpawnAgent = useCallback(async () => {
    if (!selectedAgent) return;
    setIsRunning(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('pty_spawn', {
        agentId: selectedAgent.id,
        command: selectedAgent.command,
        args: selectedAgent.args,
        sessionId,
        taskId,
      });
    } catch {
      setStatusMessage('PTY spawn not available (dev mode)');
    }
  }, [selectedAgent, sessionId, taskId]);

  const handleKillAgent = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('pty_kill', { agentId: selectedAgentId });
      setIsRunning(false);
    } catch {
      /* noop */
    }
  }, [selectedAgentId]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-surface-dark border-l border-divider">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-divider bg-surface-elevated">
        {/* Agent selector */}
        <select
          className="bg-surface-dark text-content-primary text-sm rounded px-2 py-1 border border-divider"
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {/* Run/Stop */}
        <button
          className={`px-2 py-1 rounded text-xs font-medium ${
            isRunning
              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
              : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
          }`}
          onClick={isRunning ? handleKillAgent : handleSpawnAgent}
        >
          {isRunning ? '⏹ Stop' : '▶ Run'}
        </button>

        {/* Agent info */}
        {agentInfo.model && (
          <span className="text-xs text-content-tertiary ml-auto">
            ● {agentInfo.model} | {agentInfo.tokens.toLocaleString()} tokens
            {agentInfo.ttftMs > 0 && ` | TTFT: ${agentInfo.ttftMs}ms`}
          </span>
        )}

        {/* Close */}
        {onClose && (
          <button
            className="ml-2 text-content-tertiary hover:text-content-primary"
            onClick={onClose}
          >
            ✕
          </button>
        )}
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative overflow-hidden">
        {statusMessage && !terminalRef.current && (
          <div className="absolute inset-0 flex items-center justify-center text-content-tertiary text-sm p-4 text-center">
            {statusMessage}
          </div>
        )}
        <div
          ref={terminalRef}
          className="h-full w-full"
          style={{ minHeight: '200px' }}
        />
      </div>

      {/* Action bar (shown when text is selected) */}
      {selectedText && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-divider bg-surface-elevated">
          <span className="text-xs text-content-tertiary truncate flex-1">
            Selected: {selectedText.slice(0, 80)}...
          </span>
          <button
            className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded hover:bg-blue-600/30"
            onClick={handleSubmitDeliverable}
          >
            📦 Submit as Deliverable
          </button>
          <button
            className="px-2 py-1 bg-purple-600/20 text-purple-400 text-xs rounded hover:bg-purple-600/30"
            onClick={handleWriteToSlot}
          >
            📝 Write to Slot
          </button>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center px-3 py-1 border-t border-divider bg-surface-dark text-xs text-content-tertiary">
        <span>{isRunning ? '● Connected' : '○ Idle'}</span>
        <span className="mx-2">|</span>
        <span>Agent: {selectedAgent?.name ?? selectedAgentId}</span>
        {sessionId && <><span className="mx-2">|</span><span>Session: {sessionId.slice(0, 8)}...</span></>}
        {statusMessage && <span className="ml-auto text-accent-green">{statusMessage}</span>}
      </div>
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────

const HIGH_RISK_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bdd\s+if=/,
  />\s*\/dev\/sda/,
  /\bmkfs\./,
  /(curl|wget).*\|.*(sh|bash)/,
  /\bchmod\s+777/,
];

async function checkHighRiskCommand(input: string): Promise<boolean> {
  const lower = input.toLowerCase();
  if (HIGH_RISK_PATTERNS.some((p) => p.test(lower))) {
    try {
      const resp = await fetch('/api/external/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'execution',
          title: 'High-risk terminal command detected',
          description: `Command: ${input.slice(0, 200)}`,
          urgency: 'red',
          source: { agent_id: 'agent-shell', task_id: 'terminal' },
          options: [
            { label: 'Approve execution', value: 'approve' },
            { label: 'Deny', value: 'reject' },
          ],
        }),
      });
      if (resp.ok) {
        const result = await resp.json() as any;
        // If auto-approved (L0), allow; otherwise block for Captain review
        return result.status !== 'approved';
      }
    } catch {
      // If decision API is unreachable, block by default
      return true;
    }
    return true; // Block pending decision
  }
  return false; // Safe command
}

export default AgentShell;
