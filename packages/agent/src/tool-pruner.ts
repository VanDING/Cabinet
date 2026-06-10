import { createHash } from 'node:crypto';
import type { LLMGateway } from '@cabinet/gateway';
import { ToolExecutor, type ToolDescriptor } from './tool-executor.js';

export interface ToolPrunerOptions {
  gateway: LLMGateway;
  maxTools: number;
  minTools: number;
  /** Core tools that are always included regardless of relevance score. */
  alwaysInclude?: string[];
  embeddingModel?: string;
  /** LLM model for semantic refinement (default: claude-haiku-4-5). */
  semanticModel?: string;
  /** Cache TTL in ms (default: 5 minutes). */
  cacheTtlMs?: number;
}

export interface PrunedToolSet {
  allowedTools: string[];
  reasoning: string;
}

export interface PrunerMetrics {
  totalPrunes: number;
  cacheHits: number;
  cacheMisses: number;
  embeddingOnlyCount: number;
  llmRefinedCount: number;
  llmFallbackCount: number;
  avgToolCount: number;
}

interface CacheEntry {
  result: PrunedToolSet;
  timestamp: number;
}

/**
 * Dynamic tool pruner — reduces tool variety exposed to the LLM per-turn
 * based on embedding similarity between the task description and tool metadata.
 *
 * Phase 1: Embedding-based pre-filtering (fast, <100ms)
 * Phase 2: LLM semantic refinement (when candidates > 15, ~200ms with Haiku)
 *
 * Addresses the cybernetic variety-mismatch: when 50+ tools are exposed,
 * LLM tool-selection reliability degrades. Pruning keeps the exposed set
 * within the model's effective variety ceiling (~12–18 tools).
 */
export class ToolPruner {
  private toolEmbeddings = new Map<string, number[]>();
  private toolDescriptors = new Map<string, ToolDescriptor>();
  private gateway: LLMGateway;
  private maxTools: number;
  private minTools: number;
  private alwaysInclude: Set<string>;
  private embeddingModel: string;
  private semanticModel: string;
  private cacheTtlMs: number;
  private cache = new Map<string, CacheEntry>();
  private metrics = {
    totalPrunes: 0,
    cacheHits: 0,
    cacheMisses: 0,
    embeddingOnlyCount: 0,
    llmRefinedCount: 0,
    llmFallbackCount: 0,
    totalToolCount: 0,
  };

  constructor(options: ToolPrunerOptions) {
    this.gateway = options.gateway;
    this.maxTools = options.maxTools ?? 16;
    this.minTools = options.minTools ?? 8;
    this.alwaysInclude = new Set(options.alwaysInclude ?? []);
    this.embeddingModel = options.embeddingModel ?? 'text-embedding-3-small';
    this.semanticModel = options.semanticModel ?? 'claude-haiku-4-5';
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  }

  /** Index all tools from a ToolExecutor. Call after tool registration. */
  async indexTools(executor: ToolExecutor): Promise<void> {
    const descriptors = executor.getToolDescriptors();
    if (descriptors.length === 0) return;

    // Store descriptors for LLM semantic filtering
    for (const d of descriptors) {
      this.toolDescriptors.set(d.name, d);
    }

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
    return this._pruneInternal(taskDescription);
  }

  /**
   * Context-aware pruning — enhances task description with recent conversation
   * messages to adapt tool selection to the evolving dialogue.
   *
   * @param taskDescription  The original task / user message
   * @param recentMessages   Last N conversation turns (user + assistant) to blend in
   */
  async pruneWithContext(
    taskDescription: string,
    recentMessages?: string[],
  ): Promise<PrunedToolSet> {
    if (!recentMessages || recentMessages.length === 0) {
      return this._pruneInternal(taskDescription);
    }
    const blended = `${taskDescription}\n${recentMessages.join('\n')}`;
    return this._pruneInternal(blended, { source: 'context-aware' });
  }

  /** Get current pruning metrics. */
  getMetrics(): PrunerMetrics {
    return {
      totalPrunes: this.metrics.totalPrunes,
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      embeddingOnlyCount: this.metrics.embeddingOnlyCount,
      llmRefinedCount: this.metrics.llmRefinedCount,
      llmFallbackCount: this.metrics.llmFallbackCount,
      avgToolCount:
        this.metrics.totalPrunes > 0
          ? Math.round((this.metrics.totalToolCount / this.metrics.totalPrunes) * 10) / 10
          : 0,
    };
  }

  /** Reset all metrics counters. */
  resetMetrics(): void {
    this.metrics = {
      totalPrunes: 0,
      cacheHits: 0,
      cacheMisses: 0,
      embeddingOnlyCount: 0,
      llmRefinedCount: 0,
      llmFallbackCount: 0,
      totalToolCount: 0,
    };
  }

  /** Clear the internal cache (e.g. after tool re-indexing). */
  clearCache(): void {
    this.cache.clear();
  }

  private async _pruneInternal(
    taskDescription: string,
    opts?: { source?: string },
  ): Promise<PrunedToolSet> {
    if (this.toolEmbeddings.size === 0) {
      throw new Error('ToolPruner has not been indexed. Call indexTools() first.');
    }

    this.metrics.totalPrunes++;

    // 1. Check cache
    const cacheKey = this.hashTask(taskDescription);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      this.metrics.cacheHits++;
      return cached.result;
    }
    this.metrics.cacheMisses++;

    // 2. Phase 1: Embedding-based pre-filtering
    const candidates = await this.embeddingFilter(taskDescription);

    // 3. Phase 2: LLM semantic refinement (only when candidates > 15)
    let selected: string[];
    let reasoning: string;

    if (candidates.length > 15) {
      try {
        const llmResult = await this.llmSemanticFilter(taskDescription, candidates);
        selected = llmResult.tools;
        reasoning = `Selected ${selected.length} tools via embedding pre-filter + LLM semantic refinement`;
        this.metrics.llmRefinedCount++;
      } catch (err) {
        // Fallback to embedding results on LLM failure
        selected = candidates;
        reasoning = `Selected ${selected.length} tools via embedding pre-filter (LLM refinement failed: ${(err as Error).message})`;
        this.metrics.llmFallbackCount++;
      }
    } else {
      selected = candidates;
      reasoning = `Selected ${selected.length} tools via embedding pre-filter (candidates ≤ 15, skipped LLM refinement)`;
      this.metrics.embeddingOnlyCount++;
    }

    this.metrics.totalToolCount += selected.length;

    const result: PrunedToolSet = {
      allowedTools: selected,
      reasoning,
    };

    // 4. Cache result
    this.cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  private async embeddingFilter(taskDescription: string): Promise<string[]> {
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

    const targetSize = Math.max(this.maxTools, this.minTools);
    const selected = new Set<string>(this.alwaysInclude);
    for (const { name } of scored) {
      if (selected.size >= targetSize) break;
      selected.add(name);
    }

    return [...selected];
  }

  private async llmSemanticFilter(
    taskDescription: string,
    candidates: string[],
  ): Promise<{ tools: string[] }> {
    const toolDescriptions = candidates
      .map((name) => {
        const d = this.toolDescriptors.get(name);
        if (!d) return `- ${name}: (no description)`;
        return `- ${name}: ${d.description.slice(0, 100)}`;
      })
      .join('\n');

    const prompt = [
      '从以下工具列表中选择与任务最相关的工具（最多 15 个）:',
      `任务: ${taskDescription}`,
      '工具:',
      toolDescriptions,
      '',
      '返回 JSON: { tools: ["tool1", "tool2", ...] }',
    ].join('\n');

    const response = await this.gateway.generateText({
      model: this.semanticModel,
      systemPrompt: '你是一个工具选择助手。只返回 JSON 格式，不要添加其他解释。',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
      temperature: 0,
    });

    const content = response.content ?? '';
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM did not return valid JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]) as { tools?: string[] };
    if (!Array.isArray(parsed.tools)) {
      throw new Error('LLM response missing tools array');
    }

    // Validate returned tools are in candidates
    const validTools = parsed.tools.filter((t) => candidates.includes(t));

    // Ensure alwaysInclude tools are present
    const alwaysTools = [...this.alwaysInclude].filter((t) => candidates.includes(t));
    const finalTools = new Set([...alwaysTools, ...validTools]);

    return { tools: [...finalTools] };
  }

  private serializeTool(descriptor: ToolDescriptor): string {
    const paramNames = Object.keys(
      (descriptor.parameters as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    return `${descriptor.name}: ${descriptor.description}. Parameters: ${paramNames.join(', ')}`;
  }

  private hashTask(taskDescription: string): string {
    return createHash('sha256').update(taskDescription).digest('hex').slice(0, 16);
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
