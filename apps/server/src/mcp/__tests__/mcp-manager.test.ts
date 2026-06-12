import { describe, it, expect, vi } from 'vitest';
import { MCPManager, type MCPSideEffectRisk } from '../mcp-manager.js';
import type { TrustLevel } from '@cabinet/types';

describe('MCPManager tool risk classification', () => {
  it('classifies annotated tools correctly', () => {
    const manager = new MCPManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any);

    // Simulate internal tool registration with annotations
    (manager as any).tools.set('mcp__read_file', {
      serverName: 'test',
      name: 'read_file',
      description: 'Read a file',
      inputSchema: {},
      sideEffectRisk: 'readonly',
    });
    (manager as any).tools.set('mcp__delete_file', {
      serverName: 'test',
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: {},
      sideEffectRisk: 'destructive',
    });
    (manager as any).tools.set('mcp__write_file', {
      serverName: 'test',
      name: 'write_file',
      description: 'Write a file',
      inputSchema: {},
      sideEffectRisk: 'mutation',
    });

    expect(manager.getToolRisk('mcp__read_file')).toBe('readonly');
    expect(manager.getToolRisk('mcp__delete_file')).toBe('destructive');
    expect(manager.getToolRisk('mcp__write_file')).toBe('mutation');
    expect(manager.getToolRisk('mcp__unknown')).toBeUndefined();
  });

  it('blocks destructive tool calls with disallowed paths', async () => {
    const manager = new MCPManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any);
    (manager as any).tools.set('mcp__delete_file', {
      serverName: 'test',
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: {},
      sideEffectRisk: 'destructive' as MCPSideEffectRisk,
    });
    (manager as any).clients.set('test', {
      callTool: vi.fn().mockResolvedValue({ status: 'ok' }),
    } as any);

    await expect(
      manager.callTool('mcp__delete_file', { path: '../../../etc/passwd' }),
    ).rejects.toThrow('outside allowed directories');
  });

  it('allows destructive tool calls with safe paths', async () => {
    const manager = new MCPManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any);
    (manager as any).tools.set('mcp__delete_file', {
      serverName: 'test',
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: {},
      sideEffectRisk: 'destructive' as MCPSideEffectRisk,
    });
    (manager as any).clients.set('test', {
      callTool: vi.fn().mockResolvedValue({ status: 'ok' }),
    } as any);

    const result = await manager.callTool('mcp__delete_file', {
      path: '/home/user/project/file.txt',
    });
    expect(result).toEqual({ status: 'ok' });
  });
});

describe('MCPManager callTool trust-level matrix', () => {
  const risks: { risk: MCPSideEffectRisk; category: string }[] = [
    { risk: 'none', category: 'read_only' },
    { risk: 'readonly', category: 'read_only' },
    { risk: 'mutation', category: 'moderate' },
    { risk: 'destructive', category: 'destructive' },
  ];

  function setupManager(risk: MCPSideEffectRisk) {
    const manager = new MCPManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any);
    (manager as any).tools.set('mcp__tool', {
      serverName: 'test',
      name: 'tool',
      description: 'A tool',
      inputSchema: {},
      sideEffectRisk: risk,
    });
    (manager as any).clients.set('test', {
      callTool: vi.fn().mockResolvedValue({ status: 'ok' }),
    } as any);
    return manager;
  }

  const matrix: { trustLevel: TrustLevel; allowed: string[]; blocked: string[] }[] = [
    {
      trustLevel: 'T0',
      allowed: ['read_only'],
      blocked: ['moderate', 'destructive'],
    },
    {
      trustLevel: 'T1',
      allowed: ['read_only'],
      blocked: ['moderate', 'destructive'],
    },
    {
      trustLevel: 'T2',
      allowed: ['read_only', 'moderate'],
      blocked: ['destructive'],
    },
    {
      trustLevel: 'T3',
      allowed: ['read_only', 'moderate', 'destructive'],
      blocked: [],
    },
  ];

  for (const { trustLevel, allowed } of matrix) {
    for (const { risk, category } of risks) {
      const shouldAllow = allowed.includes(category);
      it(`${trustLevel} × ${risk} (${category}) → ${shouldAllow ? 'allow' : 'block'}`, async () => {
        const manager = setupManager(risk);
        if (shouldAllow) {
          const result = await manager.callTool('mcp__tool', {}, trustLevel);
          expect(result).toEqual({ status: 'ok' });
        } else {
          await expect(manager.callTool('mcp__tool', {}, trustLevel)).rejects.toThrow(
            /MCP tool blocked/,
          );
        }
      });
    }
  }

  it('defaults to T3 when trust level is omitted', async () => {
    const manager = setupManager('destructive');
    const result = await manager.callTool('mcp__tool', {});
    expect(result).toEqual({ status: 'ok' });
  });
});

describe('MCPManager audit logging', () => {
  it('logs trustLevel and decision for blocked calls', async () => {
    const manager = new MCPManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any);
    const { AuditLogger } = await import('@cabinet/decision');
    const audit = new AuditLogger({} as any);
    const logSpy = vi.spyOn(audit, 'log').mockImplementation(() => {});
    manager.setAuditLogger(audit);
    (manager as any).tools.set('mcp__delete_file', {
      serverName: 'test',
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: {},
      sideEffectRisk: 'destructive' as MCPSideEffectRisk,
    });
    (manager as any).clients.set('test', {
      callTool: vi.fn().mockResolvedValue({ status: 'ok' }),
    } as any);

    await expect(
      manager.callTool('mcp__delete_file', { path: '/safe/file.txt' }, 'T1'),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledOnce();
    const entry = logSpy.mock.calls[0]![0];
    expect(entry.entityType).toBe('mcp_tool');
    expect(entry.changes.trustLevel).toBe('T1');
    expect(entry.changes.decision).toBe('blocked');
    expect(entry.changes.category).toBe('destructive');
    expect(entry.changes.timestamp).toMatch(/^\d{4}-/);
  });
});
