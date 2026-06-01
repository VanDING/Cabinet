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

    for (const model of models) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await this.withTimeout(
            this.gateway.generateText({ ...options, model }),
            this.timeoutMs,
          );
          return result;
        } catch (error) {
          lastError = error as Error;
          if (attempt < this.maxRetries) {
            // Exponential backoff before retrying same model
            const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          // Current model exhausted, trigger fallback to next
          const modelIdx = models.indexOf(model);
          const nextModel = models[modelIdx + 1];
          if (nextModel && this.onFallback) {
            this.onFallback(model, nextModel, error as Error);
          }
          break; // Move to next model
        }
      }
    }

    throw new Error(
      `All models exhausted for role '${this.role}'. Last error: ${lastError?.message}`,
    );
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms);
    });
    return Promise.race([
      promise.finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      }),
      timeoutPromise.finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      }),
    ]);
  }
}
