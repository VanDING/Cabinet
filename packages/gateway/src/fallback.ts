import type { LLMGateway, LLMCallOptions, LLMResponse } from './llm-gateway.js';
import { ModelRouter, type ModelRole } from './model-router.js';
import { LLM_TIMEOUT_MS, MAX_RETRY_TRANSIENT } from '@cabinet/types';

export interface FallbackOptions {
  gateway: LLMGateway;
  router: ModelRouter;
  role?: ModelRole;
  timeoutMs?: number;
  maxRetries?: number;
  onFallback?: (fromModel: string, toModel: string, error: Error) => void;
}

export class FallbackChain {
  private readonly gateway: LLMGateway;
  private readonly router: ModelRouter;
  private readonly role: ModelRole;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onFallback?: (fromModel: string, toModel: string, error: Error) => void;

  constructor(options: FallbackOptions) {
    this.gateway = options.gateway;
    this.router = options.router;
    this.role = options.role ?? 'default';
    this.timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRY_TRANSIENT;
    this.onFallback = options.onFallback;
  }

  async generateText(options: Omit<LLMCallOptions, 'model'>): Promise<LLMResponse> {
    const models = this.router.getModelChain(this.role);
    let lastError: Error | null = null;

    for (let i = 0; i < models.length && i <= this.maxRetries; i++) {
      const model = models[i]!;
      try {
        const result = await this.withTimeout(
          this.gateway.generateText({ ...options, model }),
          this.timeoutMs
        );
        return result;
      } catch (error) {
        lastError = error as Error;
        const nextModel = models[i + 1];
        if (nextModel && this.onFallback) {
          this.onFallback(model, nextModel, error as Error);
        }
        // Continue to next model if available
        if (!nextModel) break;
      }
    }

    throw new Error(
      `All models exhausted for role '${this.role}'. Last error: ${lastError?.message}`
    );
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms)
      ),
    ]);
  }
}
