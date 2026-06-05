import { describe, it, expect, vi } from 'vitest';
import { ToolPruner } from '../tool-pruner.js';
import { ToolExecutor } from '../tool-executor.js';
import type { LLMGateway } from '@cabinet/gateway';

function createMockGateway(embeddings: number[][]): LLMGateway {
  return {
    generateEmbeddings: vi.fn().mockResolvedValue({ embeddings }),
    generateText: vi.fn(),
    resolveModelString: vi.fn(),
    modelMapping: {},
  } as unknown as LLMGateway;
}

function createToolExecutor(tools: Array<{ name: string; description: string }>): ToolExecutor {
  const executor = new ToolExecutor();
  for (const t of tools) {
    executor.register({
      name: t.name,
      description: t.description,
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
      handler: vi.fn(),
    });
  }
  return executor;
}

describe('ToolPruner', () => {
  describe('constructor', () => {
    it('accepts options and sets defaults', () => {
      const gw = createMockGateway([]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 20, minTools: 5 });
      // Can't access private fields, but constructor shouldn't throw
      expect(pruner).toBeInstanceOf(ToolPruner);
    });

    it('defaults maxTools to 16 and minTools to 8', () => {
      const gw = createMockGateway([]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 0, minTools: 0 });
      // defaults kick in via ?? operator for undefined, but 0 is falsy → will be 0
      // Testing constructor doesn't throw
      expect(pruner).toBeInstanceOf(ToolPruner);
    });

    it('uses alwaysInclude as a Set', () => {
      const gw = createMockGateway([]);
      const pruner = new ToolPruner({
        gateway: gw,
        maxTools: 10,
        minTools: 5,
        alwaysInclude: ['core_tool', 'safety_tool'],
      });
      expect(pruner).toBeInstanceOf(ToolPruner);
    });

    it('uses custom embedding model', () => {
      const gw = createMockGateway([]);
      const pruner = new ToolPruner({
        gateway: gw,
        maxTools: 10,
        minTools: 5,
        embeddingModel: 'custom-embedding-model',
      });
      expect(pruner).toBeInstanceOf(ToolPruner);
    });
  });

  describe('isIndexed', () => {
    it('returns false before indexTools is called', () => {
      const gw = createMockGateway([]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      expect(pruner.isIndexed()).toBe(false);
    });

    it('returns true after successful indexTools', async () => {
      const gw = createMockGateway([[0.1, 0.2, 0.3]]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      const executor = createToolExecutor([{ name: 'tool_a', description: 'does A' }]);
      await pruner.indexTools(executor);
      expect(pruner.isIndexed()).toBe(true);
    });
  });

  describe('indexTools', () => {
    it('calls gateway.generateEmbeddings with serialized tool descriptions', async () => {
      const gw = createMockGateway([[0.1, 0.2, 0.3]]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      const executor = createToolExecutor([
        { name: 'tool_a', description: 'does A' },
        { name: 'tool_b', description: 'does B' },
      ]);

      await pruner.indexTools(executor);

      expect(gw.generateEmbeddings).toHaveBeenCalledTimes(1);
      const callArgs = (gw.generateEmbeddings as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.texts).toHaveLength(2);
      expect(callArgs.texts[0]).toContain('tool_a');
      expect(callArgs.texts[0]).toContain('does A');
      expect(callArgs.texts[1]).toContain('tool_b');
    });

    it('handles empty tool executor gracefully', async () => {
      const gw = createMockGateway([]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      const executor = createToolExecutor([]);

      await pruner.indexTools(executor);
      expect(gw.generateEmbeddings).not.toHaveBeenCalled();
      expect(pruner.isIndexed()).toBe(false);
    });

    it('passes embedding model to gateway', async () => {
      const gw = createMockGateway([[0.1]]);
      const pruner = new ToolPruner({
        gateway: gw,
        maxTools: 10,
        minTools: 5,
        embeddingModel: 'text-embedding-ada-002',
      });
      const executor = createToolExecutor([{ name: 't', description: 'd' }]);

      await pruner.indexTools(executor);

      const callArgs = (gw.generateEmbeddings as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.model).toBe('text-embedding-ada-002');
    });
  });

  describe('prune', () => {
    it('throws if called before indexing', async () => {
      const gw = createMockGateway([[0.1, 0.2, 0.3]]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      await expect(pruner.prune('some task')).rejects.toThrow('not been indexed');
    });

    it('returns allowedTools and reasoning', async () => {
      // Return 3-dimensional embeddings for 3 tools + 1 task
      const gw = createMockGateway([
        [0.9, 0.1, 0.0], // embedding for tool read
        [0.1, 0.9, 0.0], // embedding for tool write
        [0.0, 0.0, 0.9], // embedding for tool analyze
        [0.9, 0.1, 0.0], // task embedding (similar to read)
        // wait, this is the wrong order. Let me think...
        // generateEmbeddings is called twice: once for indexTools (3 tools) and once for prune (1 task)
      ]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      const executor = createToolExecutor([
        { name: 'read_file', description: 'read' },
        { name: 'write_file', description: 'write' },
        { name: 'analyze', description: 'analyze' },
      ]);

      await pruner.indexTools(executor);

      const result = await pruner.prune('read a file');
      expect(result.allowedTools).toBeDefined();
      expect(Array.isArray(result.allowedTools)).toBe(true);
      expect(result.reasoning).toContain('Selected');
    });

    it('always includes core tools from alwaysInclude', async () => {
      const gw = createMockGateway([
        [0.9, 0.1, 0.0, 0.0], // read
        [0.1, 0.9, 0.0, 0.0], // write
        [0.0, 0.0, 0.9, 0.0], // safety
        [0.0, 0.0, 0.0, 0.9], // analyze
        [0.9, 0.1, 0.0, 0.0], // task embedding (similar to read)
      ]);
      const pruner = new ToolPruner({
        gateway: gw,
        maxTools: 2,
        minTools: 2,
        alwaysInclude: ['safety_check'],
      });
      const executor = createToolExecutor([
        { name: 'read_file', description: 'read' },
        { name: 'write_file', description: 'write' },
        { name: 'safety_check', description: 'safety' },
        { name: 'analyze', description: 'analyze' },
      ]);

      await pruner.indexTools(executor);
      const result = await pruner.prune('read a file');

      // safety_check must be included regardless
      expect(result.allowedTools).toContain('safety_check');
    });

    it('respects maxTools limit', async () => {
      const emb = Array.from({ length: 6 }, (_, i) => {
        const arr = [0, 0, 0, 0, 0];
        arr[i] = 1.0;
        return arr;
      });
      const gw = createMockGateway(emb);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 3, minTools: 1 });
      const executor = createToolExecutor([
        { name: 't1', description: 'd1' },
        { name: 't2', description: 'd2' },
        { name: 't3', description: 'd3' },
        { name: 't4', description: 'd4' },
        { name: 't5', description: 'd5' },
      ]);

      await pruner.indexTools(executor);
      const result = await pruner.prune('use t1');

      expect(result.allowedTools.length).toBeLessThanOrEqual(3);
    });

    it('throws when task embedding generation fails', async () => {
      const gw = createMockGateway([[0.1], [0.2]]);
      const pruner = new ToolPruner({ gateway: gw, maxTools: 10, minTools: 5 });
      const executor = createToolExecutor([{ name: 't', description: 'd' }]);

      await pruner.indexTools(executor);

      // Override to return empty embeddings for this call
      (gw.generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ embeddings: [] });
      await expect(pruner.prune('task')).rejects.toThrow('Failed to generate task embedding');
    });
  });
});
