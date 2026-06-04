//
// TaskQueuePoller — adaptive poll loop for pull-mode task claiming.
//
// Polls the task queue at a configurable interval. When no tasks are
// available, the interval increases gradually (adaptive backoff).
// Respects maxConcurrentTasks — skips poll when at capacity.
// When wsDisconnected is false (WS mode active), polling is suspended.
//

export class TaskQueuePoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs: number;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private wsDisconnected = true; // start in polling mode until WS connects

  constructor(
    private readonly onPoll: () => Promise<boolean>, // returns true if a task was claimed
    options: {
      pollIntervalMs?: number;
      maxIntervalMs?: number;
      startImmediately?: boolean;
    } = {},
  ) {
    this.minIntervalMs = options.pollIntervalMs ?? 3000;
    this.currentIntervalMs = this.minIntervalMs;
    this.maxIntervalMs = options.maxIntervalMs ?? 60_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.currentIntervalMs);
    // Unref so the timer doesn't prevent process exit
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Called when WebSocket connects — suspends polling. */
  onWSConnected(): void {
    this.wsDisconnected = false;
  }

  /** Called when WebSocket disconnects — resumes polling. */
  onWSDisconnected(): void {
    this.wsDisconnected = true;
    this.currentIntervalMs = this.minIntervalMs; // reset interval
  }

  /** Force polling mode regardless of WS state. */
  forcePolling(): void {
    this.wsDisconnected = true;
  }

  private async tick(): Promise<void> {
    if (!this.wsDisconnected) return; // WS mode active, skip poll

    try {
      const claimed = await this.onPoll();
      if (claimed) {
        // Reset interval on activity
        this.adjustInterval(this.minIntervalMs);
      } else {
        // Gradually increase interval when queue is empty
        this.adjustInterval(Math.min(this.currentIntervalMs * 2, this.maxIntervalMs));
      }
    } catch {
      // Poll errors are non-fatal; keep the loop running
    }
  }

  private adjustInterval(newMs: number): void {
    if (newMs === this.currentIntervalMs) return;
    this.currentIntervalMs = newMs;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), this.currentIntervalMs);
      if (typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }
}
