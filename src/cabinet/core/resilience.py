from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpenError(Exception):
    pass


class ErrorCategory(Enum):
    RATE_LIMIT = "rate_limit"
    SERVER_ERROR = "server_error"
    TIMEOUT = "timeout"
    CONTEXT_OVERFLOW = "context_overflow"
    FATAL = "fatal"


@dataclass
class CircuitBreaker:
    max_failures: int = 3
    reset_timeout: float = 60.0
    failure_count: int = field(default=0, init=False)
    last_failure_time: float = field(default=0.0, init=False)
    state: CircuitState = field(default=CircuitState.CLOSED, init=False)

    def _should_reset(self) -> bool:
        return time.monotonic() - self.last_failure_time > self.reset_timeout

    async def call(self, coro_factory, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if self._should_reset():
                self.state = CircuitState.HALF_OPEN
                logger.info("Circuit breaker half-open, trying probe")
            else:
                raise CircuitBreakerOpenError(
                    f"Circuit open for {self.reset_timeout}s after {self.failure_count} failures"
                )

        try:
            result = await coro_factory(*args, **kwargs)
            if self.state == CircuitState.HALF_OPEN:
                self.state = CircuitState.CLOSED
                self.failure_count = 0
                logger.info("Circuit breaker closed (probe succeeded)")
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.monotonic()
            if self.failure_count >= self.max_failures:
                self.state = CircuitState.OPEN
                logger.error(
                    "Circuit breaker opened after %d failures: %s",
                    self.failure_count,
                    e,
                )
            raise


def classify_error(error: Exception) -> ErrorCategory:
    msg = str(error).lower()
    if "rate_limit" in msg or "429" in msg:
        return ErrorCategory.RATE_LIMIT
    if "timeout" in msg or "timed out" in msg:
        return ErrorCategory.TIMEOUT
    if "prompt_too_long" in msg or "context_length" in msg:
        return ErrorCategory.CONTEXT_OVERFLOW
    if "5xx" in msg or "500" in msg or "server_error" in msg:
        return ErrorCategory.SERVER_ERROR
    return ErrorCategory.FATAL


async def retry_with_backoff(
    coro_factory,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
):
    for attempt in range(max_retries + 1):
        try:
            return await coro_factory()
        except Exception as e:
            category = classify_error(e)
            if category == ErrorCategory.FATAL or attempt == max_retries:
                raise
            delay = min(base_delay * (2**attempt), max_delay)
            logger.warning(
                "Retry %d/%d after %.1fs (category=%s): %s",
                attempt + 1,
                max_retries,
                delay,
                category.value,
                e,
            )
            await asyncio.sleep(delay)


async def recover_from_context_overflow(
    agent, messages: list[dict], gateway
):
    for attempt in range(3):
        trim_count = max(1, len(agent._history) * 3 // 10)
        agent._history = agent._history[trim_count:]
        try:
            return await gateway.complete(messages=messages)
        except Exception as e:
            if classify_error(e) != ErrorCategory.CONTEXT_OVERFLOW or attempt == 2:
                raise
            logger.warning("Context overflow recovery attempt %d/3", attempt + 1)
