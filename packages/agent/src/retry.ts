import { MAX_RETRY_TRANSIENT, MAX_RETRY_RECOVERABLE } from '@cabinet/types';

export type ErrorCategory = 'transient' | 'recoverable' | 'fatal';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  strategy: 'exponential' | 'fixed';
}

const DEFAULT_CONFIGS: Record<ErrorCategory, RetryConfig> = {
  transient: { maxRetries: MAX_RETRY_TRANSIENT, baseDelayMs: 1000, strategy: 'exponential' },
  recoverable: { maxRetries: MAX_RETRY_RECOVERABLE, baseDelayMs: 2000, strategy: 'fixed' },
  fatal: { maxRetries: 0, baseDelayMs: 0, strategy: 'fixed' },
};

// The `error` parameter provides a provisional classification used as the initial
// RetryConfig. The actual category is re-evaluated from each thrown Error in the
// catch block, so the initial value only affects the first attempt's retry budget.
export function classifyError(error: Error): ErrorCategory {
  const msg = error.message.toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('socket')
  ) {
    return 'transient';
  }
  if (
    msg.includes('tool execution failed') ||
    msg.includes('temporary') ||
    msg.includes('retryable')
  ) {
    return 'recoverable';
  }
  return 'fatal';
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  error: Error,
  configOverrides?: Partial<RetryConfig>,
): Promise<T> {
  const category = classifyError(error);
  const config = { ...DEFAULT_CONFIGS[category], ...configOverrides };

  let lastError = error;

  // Always attempt at least once, even for fatal errors
  try {
    return await fn();
  } catch (e) {
    lastError = e as Error;
    const newCategory = classifyError(lastError);
    if (newCategory === 'fatal' || config.maxRetries === 0) throw lastError;
  }

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const delay =
      config.strategy === 'exponential'
        ? config.baseDelayMs * Math.pow(2, attempt - 1)
        : config.baseDelayMs;

    await sleep(delay);

    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      // Re-classify on each failure
      const newCategory = classifyError(lastError);
      if (newCategory === 'fatal') throw lastError;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
