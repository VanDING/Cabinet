import { describe, it, expect, vi } from 'vitest';
import { MCPManager, type MCPSideEffectRisk } from '../mcp-manager.js';

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

    const result = await manager.callTool('mcp__delete_file', { path: '/home/user/project/file.txt' });
    expect(result).toEqual({ status: 'ok' });
  });
});
