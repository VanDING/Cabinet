from __future__ import annotations

import time
from datetime import datetime, timezone
from uuid import uuid4

from cabinet.models.primitives import MemoryItem, MemoryScope
from cabinet.core.memory.scoring import MemoryScorer, MemoryScore


def _make_item(content: str, access_ts: float = 0, access_count: int = 1) -> MemoryItem:
    accessed_at = datetime.fromtimestamp(access_ts, tz=timezone.utc) if access_ts else None
    return MemoryItem(
        id=uuid4(),
        owner_id=uuid4(),
        scope=MemoryScope.LONG_TERM,
        content=content,
        metadata={"access_count": access_count},
        accessed_at=accessed_at,
    )


def test_scorer_ranks_relevant_higher():
    scorer = MemoryScorer()
    items = [
        _make_item("database connection pool settings and config"),
        _make_item("lunch menu for wednesday"),
        _make_item("pytest configuration and test runners"),
    ]
    scored = scorer.score(items, "configure database connection pool", time.time())
    assert scored[0].item.content == items[0].content
    assert scored[0].score > scored[2].score


def test_scorer_recency_boost():
    scorer = MemoryScorer()
    now = time.time()
    items = [
        _make_item("old project decision", now - 86400 * 30, 1),
        _make_item("recent project decision", now - 3600, 1),
    ]
    scored = scorer.score(items, "project decision", now)
    assert scored[0].item.content == items[1].content


def test_scorer_frequency_boost():
    scorer = MemoryScorer()
    items = [
        _make_item("rarely accessed", access_count=1),
        _make_item("frequently accessed", access_count=10),
    ]
    scored = scorer.score(items, "accessed", time.time())
    assert scored[0].item.content == items[1].content


def test_scorer_filters_below_threshold():
    scorer = MemoryScorer()
    items = [_make_item("completely unrelated topic about lunch")]
    scored = scorer.score(items, "database migration strategy", time.time())
    assert scored[0].score < 0.3


def test_scorer_handles_empty():
    scorer = MemoryScorer()
    assert scorer.score([], "query", time.time()) == []


def test_scorer_handles_empty_query():
    scorer = MemoryScorer()
    items = [_make_item("some content")]
    scored = scorer.score(items, "", time.time())
    assert len(scored) == 1
