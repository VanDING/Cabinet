from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from cabinet.core.resilience import (
    CircuitBreaker,
    CircuitBreakerOpenError,
    CircuitState,
    ErrorCategory,
    classify_error,
    recover_from_context_overflow,
    retry_with_backoff,
)


# ── CircuitBreaker ──────────────────────────────────────────

def test_circuit_breaker_opens_after_max_failures():
    breaker = CircuitBreaker(max_failures=3)
    for i in range(3):
        with pytest.raises(ValueError, match=f"fail{i}"):
            asyncio.run(breaker.call(lambda: _raise(ValueError(f"fail{i}"))))
    assert breaker.state == CircuitState.OPEN
    assert breaker.failure_count == 3


def test_circuit_breaker_rejects_calls_when_open():
    breaker = CircuitBreaker(max_failures=3, reset_timeout=999.0)
    for _ in range(3):
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(lambda: _raise(ValueError("fail"))))
    with pytest.raises(CircuitBreakerOpenError):
        asyncio.run(breaker.call(lambda: _ok("should not reach")))


def test_circuit_breaker_half_open_after_timeout():
    breaker = CircuitBreaker(max_failures=1, reset_timeout=0.01)
    with pytest.raises(ValueError):
        asyncio.run(breaker.call(lambda: _raise(ValueError("fail"))))
    assert breaker.state == CircuitState.OPEN
    time.sleep(0.02)
    result = asyncio.run(breaker.call(lambda: _ok("probe")))
    assert result == "probe"
    assert breaker.state == CircuitState.CLOSED
    assert breaker.failure_count == 0


def test_circuit_breaker_stays_open_on_probe_failure():
    breaker = CircuitBreaker(max_failures=1, reset_timeout=0.01)
    with pytest.raises(ValueError):
        asyncio.run(breaker.call(lambda: _raise(ValueError("fail"))))
    assert breaker.state == CircuitState.OPEN
    time.sleep(0.02)
    with pytest.raises(ValueError):
        asyncio.run(breaker.call(lambda: _raise(ValueError("fail again"))))
    assert breaker.state == CircuitState.OPEN


def test_circuit_breaker_partial_failure_then_success():
    """failure_count persists across CLOSED state, doesn't reset on success"""
    breaker = CircuitBreaker(max_failures=5)
    with pytest.raises(ValueError):
        asyncio.run(breaker.call(lambda: _raise(ValueError("1"))))
    with pytest.raises(ValueError):
        asyncio.run(breaker.call(lambda: _raise(ValueError("2"))))
    asyncio.run(breaker.call(lambda: _ok("success")))
    assert breaker.failure_count == 2
    assert breaker.state == CircuitState.CLOSED


def test_circuit_breaker_passes_args_to_coro():
    breaker = CircuitBreaker(max_failures=3)

    async def add(a, b):
        return a + b

    result = asyncio.run(breaker.call(add, 3, 4))
    assert result == 7


# ── retry_with_backoff ──────────────────────────────────────

def test_retry_with_backoff_retries_transient_errors():
    call_count = 0

    async def flaky():
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise TimeoutError("timed out")
        return "success"

    result = asyncio.run(retry_with_backoff(flaky, max_retries=3, base_delay=0.001))
    assert result == "success"
    assert call_count == 3


def test_retry_with_backoff_raises_after_max_retries():
    async def always_fails():
        raise TimeoutError("timed out")

    with pytest.raises(TimeoutError):
        asyncio.run(retry_with_backoff(always_fails, max_retries=2, base_delay=0.001))


def test_retry_with_backoff_does_not_retry_fatal():
    call_count = 0

    async def fatal():
        nonlocal call_count
        call_count += 1
        raise ValueError("fatal error")

    with pytest.raises(ValueError):
        asyncio.run(retry_with_backoff(fatal, max_retries=3, base_delay=0.001))
    assert call_count == 1


def test_retry_with_backoff_exponential_delays():
    delays = []

    async def track_delays():
        delays.append(time.monotonic())
        if len(delays) < 3:
            raise TimeoutError("timeout")
        return "ok"

    asyncio.run(retry_with_backoff(track_delays, max_retries=3, base_delay=0.05))
    assert len(delays) >= 2
    gap1 = delays[1] - delays[0]
    assert 0.04 <= gap1 <= 0.2


# ── classify_error ──────────────────────────────────────────

def test_classify_error_rate_limit():
    assert classify_error(Exception("rate_limit exceeded")) == ErrorCategory.RATE_LIMIT
    assert classify_error(Exception("HTTP 429 error")) == ErrorCategory.RATE_LIMIT


def test_classify_error_timeout():
    assert classify_error(Exception("request timed out")) == ErrorCategory.TIMEOUT
    assert classify_error(TimeoutError("timeout")) == ErrorCategory.TIMEOUT


def test_classify_error_context_overflow():
    assert classify_error(Exception("prompt_too_long")) == ErrorCategory.CONTEXT_OVERFLOW
    assert classify_error(Exception("context_length exceeded")) == ErrorCategory.CONTEXT_OVERFLOW


def test_classify_error_server_error():
    assert classify_error(Exception("500 internal server error")) == ErrorCategory.SERVER_ERROR
    assert classify_error(Exception("server_error")) == ErrorCategory.SERVER_ERROR


def test_classify_error_fatal():
    assert classify_error(Exception("something unexpected")) == ErrorCategory.FATAL


# ── recover_from_context_overflow ───────────────────────────

def test_recover_from_context_overflow_trims_history():
    agent = MagicMock()
    agent._history = [{"role": "user", "content": f"msg{i}"} for i in range(20)]
    gateway = AsyncMock()
    gateway.complete = AsyncMock(return_value=MagicMock(content="ok"))

    asyncio.run(recover_from_context_overflow(agent, [], gateway))
    assert len(agent._history) < 20


def test_recover_from_context_overflow_retries_up_to_3_times():
    call_count = 0

    async def fail_then_succeed(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise Exception("prompt_too_long: reduce input")
        return MagicMock(content="ok")

    agent = MagicMock()
    agent._history = [{"role": "user", "content": f"msg{i}"} for i in range(50)]
    gateway = AsyncMock()
    gateway.complete = fail_then_succeed

    asyncio.run(recover_from_context_overflow(agent, [], gateway))
    assert call_count == 3


# ── helpers ─────────────────────────────────────────────────

def _raise(exc: Exception):
    async def _inner():
        raise exc
    return _inner()


def _ok(value):
    async def _inner():
        return value
    return _inner()
