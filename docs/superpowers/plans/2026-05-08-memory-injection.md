# Memory Injection Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed limit=5 memory injection with semantic scoring (relevance + recency + frequency), add FileMemoryStore protocol compliance, and build MemoryOrchestrator for cross-backend memory assembly with consolidation.

**Architecture:** Three new classes — MemoryScorer (weighted ranking), MemoryOrchestrator (cross-backend aggregation), MemoryConsolidator (periodic SHORT_TERM → LONG_TERM summarization). FileMemoryStore upgraded to implement MemoryStore protocol. LLMAgent injection upgraded to use scorer.

**Tech Stack:** Python 3.12+, asyncio, existing MemoryStore protocol + 3 backends

---

### Task 1: MemoryScorer — Weighted Relevance Ranking

**Files:**
- Create: `src/cabinet/core/memory/scoring.py`
- Create: `tests/unit/core/test_memory_scoring.py`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/core/test_memory_scoring.py`:

```python
from __future__ import annotations

import time
from uuid import uuid4

from cabinet.models.primitives import MemoryItem, MemoryScope
from cabinet.core.memory.scoring import MemoryScorer, MemoryScore


def _make_item(content: str, access_ts: float = 0, access_count: int = 1) -> MemoryItem:
    return MemoryItem(
        id=uuid4(),
        owner_id="test-user",
        scope=MemoryScope.LONG_TERM,
        content=content,
        metadata={"access_count": access_count},
        access_at=access_ts,
    )


def test_scorer_ranks_relevant_higher():
    scorer = MemoryScorer()
    items = [
        _make_item("database connection pool settings and config"),
        _make_item("lunch menu for wednesday"),
        _make_item("pytest configuration and test runners"),
    ]
    scored = scorer.score(items, "configure database connection pool", time.time())
    assert scored[0].item.content == items[0].content  # most relevant first
    assert scored[0].score > scored[2].score


def test_scorer_recency_boost():
    scorer = MemoryScorer()
    now = time.time()
    items = [
        _make_item("old project decision", now - 86400 * 30, 1),  # 30 days old
        _make_item("recent project decision", now - 3600, 1),      # 1 hour old
    ]
    scored = scorer.score(items, "project decision", now)
    assert scored[0].item.content == items[1].content  # recent wins


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
    items = [
        _make_item("completely unrelated topic about lunch"),
    ]
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
```

Run: `pytest tests/unit/core/test_memory_scoring.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 2: Create MemoryScorer**

Create `src/cabinet/core/memory/scoring.py`:

```python
from __future__ import annotations

import math
import time as _time
from dataclasses import dataclass

from cabinet.models.primitives import MemoryItem


@dataclass
class MemoryScore:
    item: MemoryItem
    score: float  # 0.0 - 1.0


class MemoryScorer:
    """Score memories by semantic relevance (0.5) + recency (0.3) + access frequency (0.2)."""
    HALF_LIFE: float = 7 * 86400   # 7 days in seconds
    MIN_SCORE: float = 0.3          # Below this threshold, don't inject

    def score(self, items: list[MemoryItem], query: str,
              current_time: float | None = None) -> list[MemoryScore]:
        if not items:
            return []

        now = current_time if current_time is not None else _time.time()
        scored = []
        for item in items:
            semantic = self._semantic_sim(item.content, query)
            recency = self._recency(
                item.access_at.timestamp() if item.access_at else now, now
            )
            freq = self._access_freq(item)
            score = semantic * 0.5 + recency * 0.3 + freq * 0.2
            scored.append(MemoryScore(item=item, score=round(score, 4)))
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored

    def _semantic_sim(self, content: str, query: str) -> float:
        """Jaccard similarity on word overlap."""
        if not query:
            return 0.5
        c_words = set(content.lower().split())
        q_words = set(query.lower().split())
        intersection = c_words & q_words
        union = c_words | q_words
        return len(intersection) / max(len(union), 1)

    def _recency(self, access_ts: float, now: float) -> float:
        delta = max(0, now - access_ts)
        return math.exp(-delta / self.HALF_LIFE)

    def _access_freq(self, item: MemoryItem) -> float:
        count = 1
        if item.metadata:
            count = item.metadata.get("access_count", 1)
        return min(float(count) / 10.0, 1.0)
```

- [ ] **Step 3: Run tests**

```bash
cd "e:/AI转型/项目实践/Cabinet/.worktrees/agent-memory"
pytest tests/unit/core/test_memory_scoring.py -v
```
Expected: 6 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/memory/scoring.py tests/unit/core/test_memory_scoring.py
git commit -m "feat(memory): add MemoryScorer with weighted relevance ranking"
```

---

### Task 2: FileMemoryStore — Implement MemoryStore Protocol

**Files:**
- Modify: `src/cabinet/core/memory/file_store.py`

- [ ] **Step 1: Read FileMemoryStore**

Read `src/cabinet/core/memory/file_store.py` to understand existing structure.

- [ ] **Step 2: Add async MemoryStore protocol methods**

Append these methods to the `FileMemoryStore` class:

```python
    # ── MemoryStore protocol async methods ──

    async def initialize(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        pass

    async def store(self, item) -> None:
        """Store a MemoryItem as a YAML frontmatter .md file."""
        from cabinet.models.primitives import MemoryItem, MemoryScope
        file_item = FileMemoryItem(
            name=item.id.hex if hasattr(item.id, 'hex') else str(item.id)[:8],
            description=item.metadata.get("description", "") if item.metadata else "",
            type=item.scope.value if hasattr(item.scope, 'value') else str(item.scope),
            content=item.content,
        )
        self._store_sync(file_item)

    async def search(self, query: str, scope=None, limit: int = 5) -> list:
        """Search .md files in scope directory for query substring match."""
        from cabinet.models.primitives import MemoryItem, MemoryScope
        from uuid import uuid4

        scope_str = scope.value if hasattr(scope, 'value') else str(scope)
        scope_dir = self.base_dir / scope_str
        results = []
        if scope_dir.exists():
            for md_file in sorted(scope_dir.glob("*.md")):
                if md_file.name == "MEMORY.md":
                    continue
                try:
                    content = md_file.read_text(encoding="utf-8")
                    if query.lower() in content.lower():
                        item = FileMemoryItem.from_file(md_file)
                        results.append(MemoryItem(
                            id=uuid4(),
                            owner_id=item.type,
                            scope=scope if hasattr(scope, 'value') else MemoryScope.LONG_TERM,
                            content=item.content,
                            metadata={
                                "filepath": str(md_file),
                                "name": item.name,
                                "description": item.description,
                                "type": item.type,
                            },
                        ))
                except Exception:
                    continue
        return results[:limit]

    async def retrieve(self, memory_id: str) -> None | object:
        """Search all scope directories for matching filename stem."""
        from cabinet.models.primitives import MemoryItem, MemoryScope
        from uuid import uuid4

        if not self.base_dir.exists():
            return None
        for scope_dir in self.base_dir.iterdir():
            if not scope_dir.is_dir():
                continue
            for md_file in scope_dir.glob("*.md"):
                if memory_id in md_file.stem:
                    item = FileMemoryItem.from_file(md_file)
                    return MemoryItem(
                        id=uuid4(),
                        owner_id=item.type,
                        scope=MemoryScope.LONG_TERM,
                        content=item.content,
                        metadata={"filepath": str(md_file), "name": item.name},
                    )
        return None

    async def delete(self, memory_id: str) -> None:
        """Delete .md file matching the memory_id in any scope directory."""
        if not self.base_dir.exists():
            return
        for scope_dir in self.base_dir.iterdir():
            if not scope_dir.is_dir():
                continue
            for md_file in scope_dir.glob("*.md"):
                if memory_id in md_file.stem:
                    md_file.unlink()
                    return

    def _store_sync(self, file_item) -> None:
        """Internal sync store method used by the async wrapper."""
        dir_path = self.base_dir / file_item.type
        dir_path.mkdir(parents=True, exist_ok=True)
        filepath = dir_path / f"{file_item.name}.md"
        filepath.write_text(file_item.to_markdown(), encoding="utf-8")
        self._rebuild_index()
```

Ensure imports are at the top of the file.

- [ ] **Step 3: Verify protocol compatibility**

```bash
cd "e:/AI转型/项目实践/Cabinet/.worktrees/agent-memory"
python -c "
from cabinet.core.memory.file_store import FileMemoryStore
from cabinet.core.memory.protocol import MemoryStore
import tempfile, os
with tempfile.TemporaryDirectory() as d:
    store = FileMemoryStore(d)
    assert isinstance(store, MemoryStore)
    print('Protocol OK')
"
```

Expected: `Protocol OK`

- [ ] **Step 4: Run existing tests**

```bash
pytest tests/unit/core/ -q --tb=line 2>&1 | tail -3
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/memory/file_store.py
git commit -m "feat(memory): add MemoryStore protocol methods to FileMemoryStore"
```

---

### Task 3: Upgrade LLMAgent Memory Injection

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`

- [ ] **Step 1: Read current _build_messages**

Read `src/cabinet/agents/llm_agent.py`. Find `_build_messages` method.

- [ ] **Step 2: Upgrade to use MemoryScorer**

Replace the memory search block in `_build_messages`:

```python
# FIND this pattern:
        if self._memory_store:
            items = await self._memory_store.search(
                str(self._employee.id), MemoryScope.LONG_TERM, limit=5
            )
            if items:
                memory_text = "\n".join(
                    f"- {item.content}" for item in items
                )
                system_msgs.append({...})

# REPLACE with:
        if self._memory_store:
            from cabinet.core.memory.scoring import MemoryScorer
            items = await self._memory_store.search(
                str(self._employee.id), MemoryScope.LONG_TERM, limit=10
            )
            if items:
                scorer = MemoryScorer()
                scored = scorer.score(items, task)
                relevant = [s for s in scored[:3] if s.score >= MemoryScorer.MIN_SCORE]
                if relevant:
                    memory_text = "\n".join(
                        f"- [score={s.score:.2f}] {s.item.content}" for s in relevant
                    )
                    system_msgs.append({
                        "role": "system",
                        "content": f"Relevant memory:\n{memory_text}",
                    })
```

- [ ] **Step 3: Run full test suite**

```bash
pytest tests/ -q --tb=line 2>&1 | tail -3
```

Expected: all pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/llm_agent.py
git commit -m "feat(agents): upgrade memory injection with MemoryScorer for relevance ranking"
```

---

### Task 4: MemoryOrchestrator + MemoryConsolidator

**Files:**
- Create: `src/cabinet/core/memory/orchestrator.py`
- Create: `tests/unit/core/test_memory_orchestrator.py`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/core/test_memory_orchestrator.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from cabinet.core.memory.orchestrator import MemoryOrchestrator, AssembledContext
from cabinet.core.memory.scoring import MemoryScorer


def test_orchestrator_aggregates_multiple_backends():
    """Orchestrator combines results from all backends."""
    make_item = lambda c: MagicMock(content=c, owner_id="u1", metadata={}, access_at=None)
    backend1 = MagicMock()
    backend1.search = AsyncMock(return_value=[make_item("from b1")])
    backend2 = MagicMock()
    backend2.search = AsyncMock(return_value=[make_item("from b2")])

    import asyncio
    orch = MemoryOrchestrator(backends=[backend1, backend2])
    ctx = asyncio.run(orch.assemble_context("test query", "u1"))

    assert len(ctx.long_term) >= 1
    assert ctx.combined_text != ""


def test_orchestrator_deduplicates_by_content():
    """Duplicate items across backends are merged."""
    make_item = lambda: MagicMock(content="same content", owner_id="u1", metadata={}, access_at=None)
    backend1 = MagicMock()
    backend1.search = AsyncMock(return_value=[make_item()])
    backend2 = MagicMock()
    backend2.search = AsyncMock(return_value=[make_item()])

    import asyncio
    orch = MemoryOrchestrator(backends=[backend1, backend2])
    ctx = asyncio.run(orch.assemble_context("query", "u1"))

    # Should have at most 1 unique result (deduplicated)
    assert len(ctx.long_term) <= 1


def test_orchestrator_handles_backend_failure():
    """Failed backends are skipped gracefully."""
    backend1 = MagicMock()
    backend1.search = AsyncMock(side_effect=Exception("Down"))
    backend2 = MagicMock()
    backend2.search = AsyncMock(return_value=[])

    import asyncio
    orch = MemoryOrchestrator(backends=[backend1, backend2])
    ctx = asyncio.run(orch.assemble_context("query", "u1"))

    assert ctx.combined_text == ""
    assert ctx.long_term == []


def test_assembled_context_fields():
    ctx = AssembledContext(long_term=[], project=[], session_summary=None, combined_text="test")
    assert ctx.combined_text == "test"
    assert ctx.long_term == []
    assert ctx.session_summary is None
```

Run: `pytest tests/unit/core/test_memory_orchestrator.py -v`
Expected: FAIL

- [ ] **Step 2: Implement MemoryOrchestrator**

Create `src/cabinet/core/memory/orchestrator.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field

from cabinet.core.memory.scoring import MemoryScorer, MemoryScore
from cabinet.core.memory.protocol import MemoryStore
from cabinet.models.primitives import MemoryScope


@dataclass
class AssembledContext:
    long_term: list[MemoryScore] = field(default_factory=list)
    project: list[MemoryScore] = field(default_factory=list)
    session_summary: str | None = None
    combined_text: str = ""


class MemoryOrchestrator:
    """Aggregate memories from multiple backends, deduplicate, rank, and assemble."""

    def __init__(self, backends: list, scorer: MemoryScorer | None = None):
        self._backends = backends
        self._scorer = scorer or MemoryScorer()

    async def assemble_context(self, query: str, employee_id: str,
                               project_id: str | None = None) -> AssembledContext:
        all_items = []
        for backend in self._backends:
            try:
                items = await backend.search(employee_id, MemoryScope.LONG_TERM, limit=10)
                all_items.extend(items)
                if project_id:
                    p_items = await backend.search(project_id, MemoryScope.LONG_TERM, limit=5)
                    all_items.extend(p_items)
            except Exception:
                continue

        # Deduplicate by first 100 chars
        seen = set()
        unique = []
        for item in all_items:
            h = hash(item.content[:100])
            if h not in seen:
                seen.add(h)
                unique.append(item)

        # Score and rank
        scored = self._scorer.score(unique, query)

        # Separate personal vs project
        long_term = [s for s in scored if s.item.owner_id == employee_id]
        project = [s for s in scored if s.item.owner_id != employee_id]

        # Build combined text
        parts = []
        if long_term:
            top = [s for s in long_term[:3] if s.score >= MemoryScorer.MIN_SCORE]
            if top:
                parts.append("## Relevant Memories\n" + "\n".join(
                    f"- {s.item.content}" for s in top
                ))
        if project:
            top = [s for s in project[:3] if s.score >= MemoryScorer.MIN_SCORE]
            if top:
                parts.append("## Project Context\n" + "\n".join(
                    f"- {s.item.content}" for s in top
                ))

        return AssembledContext(
            long_term=long_term,
            project=project,
            combined_text="\n\n".join(parts),
        )
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/unit/core/test_memory_orchestrator.py -v
```
Expected: 4 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/memory/orchestrator.py tests/unit/core/test_memory_orchestrator.py
git commit -m "feat(memory): add MemoryOrchestrator for cross-backend memory assembly"
```

---

### Task 5: Full Integration Verification

**Files:** No production code changes

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -q --tb=line 2>&1 | tail -3
```

- [ ] **Step 2: Verify all imports**

```bash
python -c "
from cabinet.core.memory.scoring import MemoryScorer, MemoryScore
from cabinet.core.memory.orchestrator import MemoryOrchestrator, AssembledContext
from cabinet.core.memory.file_store import FileMemoryStore
print('All imports OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: full integration verification for memory injection upgrade"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| Task 1 | Create scoring.py | 6 |
| Task 2 | Modify file_store.py | — |
| Task 3 | Modify llm_agent.py | — |
| Task 4 | Create orchestrator.py | 4 |
| Task 5 | Verification | — |
| **Total** | 2 new + 2 modified | 10 new |
