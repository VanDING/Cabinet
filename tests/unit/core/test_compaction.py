from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from cabinet.core.compact import (
    ContextCompactor,
    SessionMemory,
    TokenBudget,
    format_history,
)


def test_session_memory_roundtrip(tmp_path):
    p = tmp_path / "session.md"
    mem = SessionMemory(
        summary="Key decisions: 1. Use JSON API",
        key_decisions=["Use JSON API"],
        pending_tasks=["Write tests"],
    )
    mem.save(p)
    loaded = SessionMemory.load(p)
    assert loaded is not None
    assert loaded.summary == mem.summary
    assert loaded.key_decisions == mem.key_decisions


def test_session_memory_is_fresh():
    mem = SessionMemory(summary="recent", key_decisions=[], pending_tasks=[])
    assert mem.is_fresh is True


def test_session_memory_is_stale():
    mem = SessionMemory(
        summary="old", key_decisions=[], pending_tasks=[],
        updated_at=time.monotonic() - 999,
    )
    assert mem.is_fresh is False


def test_session_memory_load_nonexistent(tmp_path):
    assert SessionMemory.load(tmp_path / "nonexistent.md") is None


def test_format_history_basic():
    history = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
    ]
    formatted = format_history(history)
    assert "[user]: Hello" in formatted
    assert "[assistant]: Hi there!" in formatted


def test_format_history_truncates():
    history = [{"role": "user", "content": "X" * 1000}]
    formatted = format_history(history, max_chars_per_msg=100)
    assert len(formatted) < 200


@pytest.mark.asyncio
async def test_context_compactor_uses_session_memory(tmp_path):
    p = tmp_path / "session.md"
    mem = SessionMemory(summary="Cached summary", key_decisions=[], pending_tasks=[])
    mem.save(p)

    gateway = MagicMock()
    compactor = ContextCompactor(gateway, session_memory_path=p)
    budget = TokenBudget(model_max_tokens=200_000)

    summary, _ = await compactor.compact([], budget)
    assert summary == "Cached summary"


@pytest.mark.asyncio
async def test_context_compactor_falls_back_to_llm(tmp_path):
    gateway = MagicMock()
    gateway.complete = AsyncMock(return_value=MagicMock(
        content="<summary>LLM generated summary</summary>"
    ))

    compactor = ContextCompactor(gateway, model="test-model")
    budget = TokenBudget(model_max_tokens=200_000)

    summary, mem = await compactor.compact(
        [{"role": "user", "content": "Task"}], budget,
    )
    assert "LLM generated summary" in summary
    gateway.complete.assert_called_once()


@pytest.mark.asyncio
async def test_context_compactor_circuit_breaker(tmp_path):
    gateway = MagicMock()
    gateway.complete = AsyncMock(side_effect=RuntimeError("API down"))

    compactor = ContextCompactor(gateway, max_failures=2)
    budget = TokenBudget(model_max_tokens=200_000)

    await compactor.compact([], budget)
    await compactor.compact([], budget)
    summary, _ = await compactor.compact([], budget)
    assert "suspended" in summary.lower()
