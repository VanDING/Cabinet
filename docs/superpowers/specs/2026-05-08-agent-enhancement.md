# Agent 增强：长期记忆 + 多 Agent 协作 — 完整设计方案

**Date**: 2026-05-08
**Status**: Approved
**Scope**: Two independent subsystems — (A) Memory injection upgrade with semantic scoring and cross-source orchestration, (B) Multi-agent collaboration with parallel execution, auto-routing, and N-party debate.

---

## 子系统 A：长期记忆与上下文注入

### 现状

`LiteLLMAgent._build_messages()` 已注入 5 条 `LONG_TERM` 记忆（`search(limit=5)`），`ContextCompactor` 已有跨会话 `SessionMemory`。缺口在于：
- 无相关性评分，固定取 5 条，可能注入无关记忆
- `FileMemoryStore` 未实现 `MemoryStore` 协议
- 无跨后端整合、无记忆巩固/过期

### Phase 1：精准增强

**A1.1 MemoryScorer** (`src/cabinet/core/memory/scoring.py`)

加权评分替代固定 limit=5：

```python
from dataclasses import dataclass
from cabinet.models.primitives import MemoryItem

@dataclass
class MemoryScore:
    item: MemoryItem
    score: float  # 0.0 - 1.0

class MemoryScorer:
    """Score memories by semantic relevance + recency + access frequency."""
    HALF_LIFE: float = 7 * 86400  # 7 days in seconds

    def score(self, items: list[MemoryItem], query: str,
              current_time: float | None = None) -> list[MemoryScore]:
        import time
        now = current_time or time.time()
        scored = []
        for item in items:
            semantic = self._semantic_sim(item.content, query)  # 0.0-1.0 via substring/word overlap
            recency = self._recency(item.access_at.timestamp() if item.access_at else now, now)
            freq = self._access_freq(item)
            score = semantic * 0.5 + recency * 0.3 + freq * 0.2
            scored.append(MemoryScore(item=item, score=score))
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored

    def _semantic_sim(self, content: str, query: str) -> float:
        """Word overlap Jaccard similarity."""
        c_words = set(content.lower().split())
        q_words = set(query.lower().split())
        if not q_words:
            return 0.5
        intersection = c_words & q_words
        union = c_words | q_words
        return len(intersection) / max(len(union), 1)

    def _recency(self, access_ts: float, now: float) -> float:
        """Exponential decay with 7-day half-life."""
        import math
        delta = max(0, now - access_ts)
        return math.exp(-delta / self.HALF_LIFE)

    def _access_freq(self, item: MemoryItem) -> float:
        """Normalized access frequency from metadata."""
        count = item.metadata.get("access_count", 1) if item.metadata else 1
        return min(count / 10.0, 1.0)
```

**A1.2 FileMemoryStore 协议一致性** (`src/cabinet/core/memory/file_store.py`)

新增 async 方法实现 `MemoryStore` 协议：

```python
class FileMemoryStore:
    # ... existing sync methods ...

    async def initialize(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        pass

    async def store(self, item: MemoryItem) -> None:
        file_item = FileMemoryItem(
            name=item.id.hex if hasattr(item.id, 'hex') else str(item.id),
            description=item.metadata.get("description", "") if item.metadata else "",
            type=item.scope.value,
            content=item.content,
        )
        self._store_sync(file_item)

    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        """Full-text search across all .md files in the scope directory."""
        # Simple: grep content across all .md files matching scope
        results = []
        scope_dir = self.base_dir / scope.value
        if scope_dir.exists():
            for md_file in scope_dir.glob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    if query.lower() in content.lower():
                        item = FileMemoryItem.from_file(md_file)
                        results.append(MemoryItem(
                            id=uuid4(),  # derive from filename hash
                            owner_id="file",
                            scope=scope,
                            content=item.content,
                            metadata={"filepath": str(md_file), "name": item.name},
                        ))
                except Exception:
                    continue
        return results[:limit]

    async def retrieve(self, memory_id: str) -> MemoryItem | None:
        # Search all scopes for matching filename
        for scope_dir in self.base_dir.iterdir():
            if scope_dir.is_dir():
                for md_file in scope_dir.glob("*.md"):
                    if md_file.stem in memory_id or memory_id in md_file.stem:
                        item = FileMemoryItem.from_file(md_file)
                        return MemoryItem(...)
        return None

    async def delete(self, memory_id: str) -> None:
        for scope_dir in self.base_dir.iterdir():
            if scope_dir.is_dir():
                for md_file in scope_dir.glob("*.md"):
                    if md_file.stem in memory_id:
                        md_file.unlink()
                        return
```

**A1.3 LLMAgent 注入升级** (`src/cabinet/agents/llm_agent.py`)

`_build_messages()` 改为使用 `MemoryScorer`：

```python
async def _build_messages(self, task: str) -> list[dict]:
    ...
    if self._memory_store:
        items = await self._memory_store.search(
            str(self._employee.id), MemoryScope.LONG_TERM, limit=10
        )
        if items:
            scorer = MemoryScorer()
            scored = scorer.score(items, task)
            # Take top-3 with score >= 0.3
            relevant = [s for s in scored[:3] if s.score >= 0.3]
            if relevant:
                memory_text = "\n".join(
                    f"[score={s.score:.2f}] {s.item.content}" for s in relevant
                )
                system_msgs.append(...)
```

### Phase 2：全面整合

**A2.1 MemoryOrchestrator** (`src/cabinet/core/memory/orchestrator.py`)

```python
from dataclasses import dataclass, field

@dataclass
class AssembledContext:
    long_term: list[MemoryScore]
    project: list[MemoryScore]
    session_summary: str | None
    combined_text: str

class MemoryOrchestrator:
    """Aggregate memories from multiple backends, deduplicate, rank, and assemble."""

    def __init__(self, backends: list[MemoryStore], scorer: MemoryScorer | None = None):
        self._backends = backends
        self._scorer = scorer or MemoryScorer()

    async def assemble_context(self, query: str, employee_id: str,
                               project_id: str | None = None) -> AssembledContext:
        # 1. Search all backends
        all_items: list[MemoryItem] = []
        for backend in self._backends:
            try:
                items = await backend.search(employee_id, MemoryScope.LONG_TERM, limit=10)
                all_items.extend(items)
                if project_id:
                    p_items = await backend.search(project_id, MemoryScope.LONG_TERM, limit=5)
                    all_items.extend(p_items)
            except Exception:
                continue

        # 2. Deduplicate by content hash
        seen = set()
        unique = []
        for item in all_items:
            h = hash(item.content[:100])
            if h not in seen:
                seen.add(h)
                unique.append(item)

        # 3. Score and rank
        scored = self._scorer.score(unique, query)

        # 4. Separate by type (project vs personal based on owner_id)
        long_term = [s for s in scored if s.item.owner_id == employee_id]
        project = [s for s in scored if s.item.owner_id != employee_id]

        # 5. Build combined text
        parts = []
        if long_term:
            parts.append("## Relevant Memories\n" + "\n".join(
                f"- {s.item.content}" for s in long_term[:3] if s.score >= 0.3
            ))
        if project:
            parts.append("## Project Context\n" + "\n".join(
                f"- {s.item.content}" for s in project[:3] if s.score >= 0.3
            ))

        return AssembledContext(
            long_term=long_term,
            project=project,
            session_summary=None,
            combined_text="\n\n".join(parts),
        )
```

**A2.2 MemoryConsolidator** (`src/cabinet/core/memory/orchestrator.py` 追加)

```python
class MemoryConsolidator:
    """Periodically consolidate SHORT_TERM memories into LONG_TERM summaries."""

    def __init__(self, store: MemoryStore, gateway, threshold: int = 50):
        self._store = store
        self._gateway = gateway
        self._threshold = threshold

    async def consolidate(self, owner_id: str) -> int:
        """If SHORT_TERM count > threshold, summarize via LLM → store as LONG_TERM."""
        items = await self._store.search(owner_id, MemoryScope.SHORT_TERM, limit=200)
        if len(items) < self._threshold:
            return 0

        # Summarize via LLM
        all_content = "\n".join(f"- {item.content}" for item in items)
        response = await self._gateway.complete(
            messages=[{
                "role": "user",
                "content": f"Summarize these conversation fragments into 3-5 key insights:\n{all_content}",
            }],
            model="default",
            temperature=0.3,
        )

        # Store consolidated memory
        from uuid import uuid4
        await self._store.store(MemoryItem(
            id=uuid4(),
            owner_id=owner_id,
            scope=MemoryScope.LONG_TERM,
            content=response.content,
            metadata={"type": "consolidation", "source_count": len(items)},
        ))

        return len(items)
```

### 文件变更 A

| 文件 | 操作 |
|------|------|
| `src/cabinet/core/memory/scoring.py` | **新建** |
| `src/cabinet/core/memory/orchestrator.py` | **新建** |
| `src/cabinet/core/memory/file_store.py` | 修改（实现协议） |
| `src/cabinet/agents/llm_agent.py` | 修改（MemoryScorer + Orchestrator） |
| `tests/unit/core/test_memory_scoring.py` | **新建** |
| `tests/unit/core/test_memory_orchestrator.py` | **新建** |

---

## 子系统 B：多 Agent 协作与辩论

### Phase 1：并行执行 + 结果合成

**B1.1 ParallelExecutor** (`src/cabinet/agents/parallel.py`)

```python
import asyncio
from dataclasses import dataclass, field

@dataclass
class AgentTask:
    agent: object  # BaseAgent
    task: str
    role_label: str = ""

@dataclass
class SynthesizedResult:
    summary: str
    individual_results: list[dict]
    consensus: str | None = None
    disagreements: list[str] = field(default_factory=list)

class ParallelExecutor:
    """Fan-out task to multiple agents, fan-in results via LLM synthesis."""

    def __init__(self, synthesizer_gateway, model: str = "default"):
        self._gateway = synthesizer_gateway
        self._model = model

    async def execute_parallel(self, tasks: list[AgentTask]) -> SynthesizedResult:
        if not tasks:
            return SynthesizedResult(summary="", individual_results=[])

        # Fan-out: execute all agents concurrently
        async def _run(task: AgentTask):
            try:
                output = await task.agent.execute(task.task, None)
                return {"role": task.role_label, "task": task.task,
                        "content": output.content, "status": output.status}
            except Exception as e:
                return {"role": task.role_label, "task": task.task,
                        "content": str(e), "status": "error"}

        results = await asyncio.gather(*[_run(t) for t in tasks], return_exceptions=True)

        # Normalize exceptions
        normalized = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                normalized.append({"role": tasks[i].role_label, "task": tasks[i].task,
                                   "content": str(r), "status": "error"})
            else:
                normalized.append(r)

        # Fan-in: synthesize via LLM
        synthesis = await self._synthesize(normalized)
        return synthesis

    async def _synthesize(self, results: list[dict]) -> SynthesizedResult:
        parts = []
        for r in results:
            parts.append(f"[{r['role']}]: {r['content'][:300]}")
        joined = "\n\n".join(parts)

        response = await self._gateway.complete(
            messages=[{
                "role": "system",
                "content": "Synthesize the following agent outputs. Identify consensus, disagreements, and produce a unified summary.",
            }, {
                "role": "user",
                "content": f"Agent outputs:\n{joined}",
            }],
            model=self._model,
            temperature=0.3,
        )

        return SynthesizedResult(
            summary=response.content,
            individual_results=results,
        )
```

### Phase 2：自动移交路由

**B2.1 HandoffManager 增强** (`src/cabinet/agents/handoff.py`)

```python
class HandoffManager:
    # ... existing methods ...

    async def auto_route(
        self, task: str, from_agent_id: str,
        capability_registry,  # CapabilityRegistry
        strategy: str = "least_loaded",
    ) -> HandoffResponse | None:
        """Auto-discover best target agent and send handoff."""
        candidates = capability_registry.discover(query=task)
        if not candidates:
            return None

        best = self._select_best(candidates, strategy)

        request = HandoffRequest(
            from_agent_id=from_agent_id,
            to_agent_id=best["agent_id"],
            task_description=task,
            context_snapshot={"task": task, "reason": best.get("match_reason", "")},
            reason="expertise",
        )
        return await self.request_handoff(request)

    def _select_best(self, candidates: list[dict], strategy: str) -> dict:
        if strategy == "least_loaded":
            candidates.sort(key=lambda c: c.get("current_load", 0))
        elif strategy == "highest_skill_match":
            candidates.sort(key=lambda c: c.get("skill_count", 0), reverse=True)
        return candidates[0]
```

**B2.2 HandoffHooks** (`src/cabinet/agents/handoff.py`)

```python
from collections.abc import Callable, Awaitable

@dataclass
class HandoffHooks:
    before_handoff: Callable[[HandoffRequest], Awaitable[None]] | None = None
    after_accept: Callable[[HandoffRequest, HandoffResponse], Awaitable[None]] | None = None
    on_reject: Callable[[HandoffRequest, HandoffResponse], Awaitable[None]] | None = None
    on_timeout: Callable[[HandoffRequest], Awaitable[None]] | None = None
```

### Phase 3：N 方辩论升级

**B3.1 NPartyDebate** (`src/cabinet/agents/debate.py`)

```python
@dataclass
class DebatePosition:
    agent: object  # BaseAgent
    stance: str    # "pro", "con", "neutral_critic", "synthesizer"

class NPartyDebate:
    """Multi-position debate with parallel position statements and N-party voting."""

    def __init__(self, positions: list[DebatePosition],
                 moderator_gateway, max_rounds: int = 3):
        if len(positions) < 2:
            raise ValueError("Need at least 2 positions")
        self._positions = positions
        self._gateway = moderator_gateway
        self._max_rounds = max_rounds

    async def run(self, topic: str) -> DebateResult:
        # Phase 1: All positions state initial views (parallel)
        opening_tasks = [
            AgentTask(agent=p.agent,
                      task=f"State your {p.stance} position on: {topic}",
                      role_label=p.stance)
            for p in self._positions
        ]
        executor = ParallelExecutor(self._gateway)
        openings = await executor.execute_parallel(opening_tasks)

        # Phase 2: Rebuttal rounds (sequential, each responds to previous)
        all_statements = list(openings.individual_results)
        for round_num in range(self._max_rounds):
            for pos in self._positions:
                others = [s for s in all_statements
                         if s.get("role") != pos.stance]
                critique_task = f"Topic: {topic}\nYour stance: {pos.stance}\nOther positions:\n{self._format_others(others)}\n\nProvide your rebuttal or refinement."
                output = await pos.agent.execute(critique_task, None)
                all_statements.append({
                    "role": pos.stance,
                    "content": output.content,
                    "round": round_num + 1,
                })

        # Phase 3: Vote + moderate
        final = await self._moderate(topic, all_statements)
        return final

    async def _moderate(self, topic: str, statements: list[dict]) -> DebateResult:
        joined = "\n".join(f"[{s.get('role')}]: {s['content'][:200]}" for s in statements)
        response = await self._gateway.complete(
            messages=[{
                "role": "system",
                "content": "You are a debate moderator. Summarize the debate, identify consensus, note disagreements, and provide a final recommendation.",
            }, {
                "role": "user",
                "content": f"Topic: {topic}\n\nDebate:\n{joined}",
            }],
            model="default",
            temperature=0.3,
        )
        return DebateResult(
            statements=statements,
            consensus="consensus" in response.content.lower(),
            final_verdict=response.content,
        )

    @staticmethod
    def _format_others(statements: list[dict]) -> str:
        return "\n".join(f"[{s.get('role')}]: {s['content'][:200]}" for s in statements[-6:])
```

### 文件变更 B

| 文件 | 操作 |
|------|------|
| `src/cabinet/agents/parallel.py` | **新建** |
| `src/cabinet/agents/handoff.py` | 修改（auto_route + HandoffHooks） |
| `src/cabinet/agents/debate.py` | 修改（NPartyDebate + DebatePosition） |
| `tests/unit/agents/test_parallel.py` | **新建** |
| `tests/unit/agents/test_nparty_debate.py` | **新建** |

---

## 总文件变更汇总

```
新建 (6):
  src/cabinet/core/memory/scoring.py
  src/cabinet/core/memory/orchestrator.py
  src/cabinet/agents/parallel.py
  tests/unit/core/test_memory_scoring.py
  tests/unit/core/test_memory_orchestrator.py
  tests/unit/agents/test_parallel.py
  tests/unit/agents/test_nparty_debate.py

修改 (5):
  src/cabinet/core/memory/file_store.py
  src/cabinet/agents/llm_agent.py
  src/cabinet/agents/handoff.py
  src/cabinet/agents/debate.py
```

## 测试策略

| 子系统 | 测试文件 | 测试数 |
|--------|---------|--------|
| A | `test_memory_scoring.py` | 6（评分公式、衰减、top-N、阈值过滤） |
| A | `test_memory_orchestrator.py` | 5（多后端聚合、去重、组装、巩固） |
| B | `test_parallel.py` | 5（并行执行、异常处理、合成、空输入） |
| B | `test_nparty_debate.py` | 4（开局、反驳、投票、多立场） |

## 风险

| 风险 | 缓解 |
|------|------|
| MemoryScorer 的 word-overlap 对中文效果差 | 加入 jieba 分词（可选依赖），回退到字符级 n-gram |
| FileMemoryStore 的 grep 搜索在大文件上慢 | 索引 .md 文件的 YAML frontmatter 到内存 dict，1k 文件以内足够 |
| ParallelExecutor 并发导致 LLM rate limit | 复用已有 CircuitBreaker + 指数退避 |
| NPartyDebate 轮次过多导致 token 溢出 | max_rounds=3 + 每轮截断到 200 字符 |
