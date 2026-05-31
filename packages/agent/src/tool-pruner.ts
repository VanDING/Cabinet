import type { LLMGateway } from '@cabinet/gateway';
import { ToolExecutor, type ToolDescriptor } from './tool-executor.js';

export interface ToolPrunerOptions {
  gateway: LLMGateway;
  maxTools: number;
  minTools: number;
  /** Core tools that are always included regardless of relevance score. */
  alwaysInclude?: string[];
  embeddingModel?: string;
}

export interface PrunedToolSet {
  allowedTools: string[];
  reasoning: string;
}

/**
 * Dynamic tool pruner — reduces tool variety exposed to the LLM per-turn
 * based on embedding similarity between the task description and tool metadata.
 *
 * Addresses the cybernetic variety-mismatch: when 50+ tools are exposed,
 * LLM tool-selection reliability degrades. Pruning keeps the exposed set
 * within the model's effective variety ceiling (~12–18 tools).
 */
export class ToolPruner {
  private toolEmbeddings = new Map<string, number[]>();
  private gateway: LLMGateway;
  private maxTools: number;
  private minTools: number;
  private alwaysInclude: Set<string>;
  private embeddingModel: string;

  constructor(options: ToolPrunerOptions) {
    this.gateway = options.gateway;
    this.maxTools = options.maxTools ?? 16;
    this.minTools = options.minTools ?? 8;
    this.alwaysInclude = new Set(options.alwaysInclude ?? []);
    this.embeddingModel = options.embeddingModel ?? 'text-embedding-3-small';
  }

  /** Index all tools from a ToolExecutor. Call after tool registration. */
  async indexTools(executor: ToolExecutor): Promise<void> {
    const descriptors = executor.getToolDescriptors();
    if (descriptors.length === 0) return;

    const texts = descriptors.map((d) => this.serializeTool(d));
    const result = await this.gateway.generateEmbeddings({ texts, model: this.embeddingModel });

    for (let i = 0; i < descriptors.length; i++) {
      this.toolEmbeddings.set(descriptors[i]!.name, result.embeddings[i]!);
    }
  }

  /** Whether tools have been indexed. */
  isIndexed(): boolean {
    return this.toolEmbeddings.size > 0;
  }

  /** Compute relevance-ranked tool subset for a task. */
  async prune(taskDescription: string): Promise<PrunedToolSet> {
    if (this.toolEmbeddings.size === 0) {
      throw new Error('ToolPruner has not been indexed. Call indexTools() first.');
    }

    const result = await this.gateway.generateEmbeddings({
      texts: [taskDescription],
      model: this.embeddingModel,
    });
    const taskEmbedding = result.embeddings[0];
    if (!taskEmbedding) {
      throw new Error('Failed to generate task embedding');
    }

    const scored: Array<{ name: string; score: number }> = [];
    for (const [name, embedding] of this.toolEmbeddings) {
      const score = cosineSimilarity(taskEmbedding, embedding);
      scored.push({ name, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const selected = new Set<string>(this.alwaysInclude);
    for (const { name } of scored) {
      if (selected.size >= this.maxTools) break;
      selected.add(name);
    }

    // Ensure minimum coverage
    if (selected.size < this.minTools) {
      for (const { name } of scored) {
        if (selected.size >= this.minTools) break;
        selected.add(name);
      }
    }

    return {
      allowedTools: [...selected],
      reasoning: `Selected ${selected.size} tools by relevance to task`,
    };
  }

  private serializeTool(descriptor: ToolDescriptor): string {
    const paramNames = Object.keys(
      (descriptor.parameters as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    return `${descriptor.name}: ${descriptor.description}. Parameters: ${paramNames.join(', ')}`;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
