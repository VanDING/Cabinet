from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from cabinet.core.memory.orchestrator import MemoryOrchestrator, AssembledContext
from cabinet.core.memory.scoring import MemoryScorer


def _make_mock_item(content, owner="u1"):
    from datetime import datetime, timezone
    m = MagicMock()
    m.content = content
    m.owner_id = owner
    m.metadata = {}
    m.accessed_at = datetime.now(timezone.utc)
    m.id = uuid4()
    return m


def test_orchestrator_aggregates_multiple_backends():
    backend1 = MagicMock()
    backend1.search = AsyncMock(return_value=[_make_mock_item("from b1")])
    backend2 = MagicMock()
    backend2.search = AsyncMock(return_value=[_make_mock_item("from b2")])

    import asyncio
    orch = MemoryOrchestrator(backends=[backend1, backend2])
    ctx = asyncio.run(orch.assemble_context("test query", "u1"))

    assert len(ctx.long_term) >= 1
    assert ctx.combined_text != ""


def test_orchestrator_deduplicates_by_content():
    b1 = MagicMock()
    b1.search = AsyncMock(return_value=[_make_mock_item("same content")])
    b2 = MagicMock()
    b2.search = AsyncMock(return_value=[_make_mock_item("same content")])

    import asyncio
    orch = MemoryOrchestrator(backends=[b1, b2])
    ctx = asyncio.run(orch.assemble_context("query", "u1"))

    assert len(ctx.long_term) <= 1


def test_orchestrator_handles_backend_failure():
    b1 = MagicMock()
    b1.search = AsyncMock(side_effect=Exception("Down"))
    b2 = MagicMock()
    b2.search = AsyncMock(return_value=[])

    import asyncio
    orch = MemoryOrchestrator(backends=[b1, b2])
    ctx = asyncio.run(orch.assemble_context("query", "u1"))

    assert ctx.combined_text == ""
    assert ctx.long_term == []


def test_assembled_context_fields():
    ctx = AssembledContext(long_term=[], project=[], session_summary=None, combined_text="test")
    assert ctx.combined_text == "test"
    assert ctx.long_term == []
    assert ctx.session_summary is None
