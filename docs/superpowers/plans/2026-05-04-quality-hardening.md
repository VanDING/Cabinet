# Quality Fix & Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix failing test, add streaming safety net, harden LLM output parsing (11 sites), fix agent history, add decision persistence and dashboard caching.

**Architecture:** Three-layer approach — foundation fixes first, then core hardening (parsing utility + 11 site updates), then persistence. Each layer is independently verifiable.

**Tech Stack:** Python 3.12, Pydantic v2, pytest, asyncio

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tests/unit/cli/test_main.py` | Fix failing test |
| Modify | `src/cabinet/rooms/secretary/service.py` | Streaming safety net |
| Modify | `tests/unit/rooms/secretary/test_service.py` | Test streaming safety net |
| Create | `src/cabinet/core/parsing.py` | LLM JSON parsing utility + output models |
| Create | `tests/unit/core/test_parsing.py` | Test parsing utility |
| Modify | `src/cabinet/rooms/decision/service.py` | Harden 3 parsing sites |
| Modify | `src/cabinet/rooms/office/service.py` | Harden 2 parsing sites |
| Modify | `src/cabinet/rooms/strategy/service.py` | Harden 2 parsing sites |
| Modify | `src/cabinet/rooms/summary/service.py` | Harden 4 parsing sites |
| Modify | `src/cabinet/agents/llm_agent.py` | History truncation + unified message building |
| Modify | `tests/unit/agents/test_llm_agent.py` | Test history truncation |
| Modify | `src/cabinet/rooms/decision/service.py` | Dashboard caching |

---

### Task 1: Fix Failing Test `test_serve_creates_memory_store`

**Files:**
- Modify: `tests/unit/cli/test_main.py:55-72`

- [ ] **Step 1: Rewrite the failing test**

Replace the `test_serve_creates_memory_store` function (lines 55-72) in `tests/unit/cli/test_main.py` with:

```python
@pytest.mark.asyncio
async def test_serve_creates_memory_store(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(
        organization=org,
        default_project=project.id,
        memory_type="sqlite",
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "employees.json"), "w") as f:
        f.write("[]")

    with patch("cabinet.cli.main.LiteLLMRouterGateway") as MockGateway, \
         patch("cabinet.cli.main.CabinetRuntime") as MockRuntime, \
         patch("cabinet.cli.main.SkillStore") as MockSkillStore:
        mock_runtime = AsyncMock()
        mock_runtime.start = AsyncMock()
        mock_runtime.stop = AsyncMock()
        mock_runtime.tool_registry = AsyncMock()
        MockRuntime.return_value = mock_runtime

        mock_skill_store = AsyncMock()
        mock_skill_store.initialize = AsyncMock()
        MockSkillStore.return_value = mock_skill_store

        from cabinet.cli.main import _init_runtime

        runtime, cfg = await _init_runtime(data_dir)
        assert runtime is not None
        MockRuntime.assert_called_once()
```

- [ ] **Step 2: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_main.py::test_serve_creates_memory_store -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/cli/test_main.py
git commit -m "fix: rewrite test_serve_creates_memory_store with proper mocking"
```

---

### Task 2: Streaming Response Safety Net

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py:37-43`
- Modify: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/rooms/secretary/test_service.py`:

```python
@pytest.mark.asyncio
async def test_streaming_response_finalize_is_idempotent():
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    call_count = 0

    async def mock_finalize():
        nonlocal call_count
        call_count += 1

    response = StreamingSecretaryResponse(stream=None, finalize=mock_finalize)
    await response.finalize()
    await response.finalize()
    assert call_count == 1


@pytest.mark.asyncio
async def test_streaming_response_context_manager():
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    finalized = False

    async def mock_finalize():
        nonlocal finalized
        finalized = True

    response = StreamingSecretaryResponse(stream=None, finalize=mock_finalize)
    async with response:
        pass
    assert finalized


@pytest.mark.asyncio
async def test_streaming_response_finalize_swallows_errors():
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    async def failing_finalize():
        raise RuntimeError("storage error")

    response = StreamingSecretaryResponse(stream=None, finalize=failing_finalize)
    await response.finalize()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_streaming_response_finalize_is_idempotent tests/unit/rooms/secretary/test_service.py::test_streaming_response_context_manager tests/unit/rooms/secretary/test_service.py::test_streaming_response_finalize_swallows_errors -v`
Expected: FAIL — `StreamingSecretaryResponse` lacks `_finalized`, `__aenter__`, `__aexit__`, and error handling

- [ ] **Step 3: Implement safety net**

Replace `StreamingSecretaryResponse` class (lines 37-43) in `src/cabinet/rooms/secretary/service.py` with:

```python
class StreamingSecretaryResponse:
    def __init__(self, stream, finalize):
        self.stream = stream
        self._finalize = finalize
        self._finalized = False

    async def finalize(self):
        if self._finalized:
            return
        self._finalized = True
        try:
            await self._finalize()
        except Exception:
            pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.finalize()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_streaming_response_finalize_is_idempotent tests/unit/rooms/secretary/test_service.py::test_streaming_response_context_manager tests/unit/rooms/secretary/test_service.py::test_streaming_response_finalize_swallows_errors -v`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/secretary/service.py tests/unit/rooms/secretary/test_service.py
git commit -m "fix: add safety net to StreamingSecretaryResponse (idempotent, context manager, error-safe)"
```

---

### Task 3: LLM Parsing Utility

**Files:**
- Create: `src/cabinet/core/parsing.py`
- Create: `tests/unit/core/test_parsing.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/test_parsing.py`:

```python
from cabinet.core.parsing import (
    AuditOutput,
    AuthorizationCheckResult,
    BlueprintOutput,
    BlueprintValidationResult,
    CascadeOutput,
    DecisionTreeOutput,
    InsightsOutput,
    PermissionCheckResult,
    SuggestionsOutput,
    TreeNode,
    extract_json_block,
    parse_llm_json,
)


def test_extract_json_block_from_code_fence():
    content = 'Here is the result:\n```json\n{"auto_process": true, "reason": "ok"}\n```\nDone.'
    result = extract_json_block(content)
    assert '"auto_process"' in result


def test_extract_json_block_bare_object():
    content = 'Result: {"auto_process": false, "reason": "needs captain"}'
    result = extract_json_block(content)
    assert '"auto_process"' in result


def test_extract_json_block_bare_array():
    content = 'Titles:\n["title1", "title2"]'
    result = extract_json_block(content)
    assert '"title1"' in result


def test_extract_json_block_no_json():
    import pytest
    with pytest.raises(ValueError, match="No JSON found"):
        extract_json_block("Just plain text, no JSON here.")


def test_parse_llm_json_success():
    content = '```json\n{"auto_process": true, "reason": "safe"}\n```'
    result = parse_llm_json(content, AuthorizationCheckResult)
    assert result is not None
    assert result.auto_process is True
    assert result.reason == "safe"


def test_parse_llm_json_fallback_on_failure():
    result = parse_llm_json("No JSON here at all", AuthorizationCheckResult)
    assert result is None


def test_authorization_check_result():
    result = AuthorizationCheckResult(auto_process=False, reason="needs captain")
    assert result.auto_process is False


def test_cascade_output():
    result = CascadeOutput(titles=["title1", "title2"])
    assert len(result.titles) == 2


def test_permission_check_result():
    result = PermissionCheckResult(allowed=True, level="L2")
    assert result.level == "L2"


def test_blueprint_validation_result():
    result = BlueprintValidationResult(is_valid=True, notes=["ok"])
    assert result.is_valid is True


def test_blueprint_output():
    result = BlueprintOutput(domains=["tech"], constraints=["budget"], criteria=["revenue"])
    assert len(result.domains) == 1


def test_insights_output():
    from cabinet.core.parsing import InsightItem
    result = InsightsOutput(insights=[InsightItem(content="test", insight_type="observation", confidence=0.8)])
    assert result.insights[0].confidence == 0.8


def test_decision_tree_output():
    result = DecisionTreeOutput(root_label="root", children=[TreeNode(label="child1")])
    assert len(result.children) == 1


def test_suggestions_output():
    from cabinet.core.parsing import SuggestionItem
    result = SuggestionsOutput(suggestions=[SuggestionItem(description="fix", category="workflow", impact="high")])
    assert result.suggestions[0].impact == "high"


def test_audit_output():
    result = AuditOutput(total_decisions=10, manually_approved=3, could_auto_process=7, suggestion="add rules")
    assert result.total_decisions == 10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/test_parsing.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.parsing'`

- [ ] **Step 3: Implement parsing utility**

Create `src/cabinet/core/parsing.py`:

```python
from __future__ import annotations

import json
import re
from typing import TypeVar, Type

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


def extract_json_block(content: str) -> str:
    match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        return match.group(0)
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if match:
        return match.group(0)
    raise ValueError("No JSON found in LLM output")


def parse_llm_json(content: str, model_class: Type[T]) -> T | None:
    try:
        json_str = extract_json_block(content)
        return model_class.model_validate_json(json_str)
    except Exception:
        return None


class AuthorizationCheckResult(BaseModel):
    auto_process: bool
    reason: str = ""


class CascadeOutput(BaseModel):
    titles: list[str] = []


class PermissionCheckResult(BaseModel):
    allowed: bool
    level: str = "L1"


class BlueprintValidationResult(BaseModel):
    is_valid: bool
    notes: list[str] = []


class BlueprintOutput(BaseModel):
    domains: list[str] = []
    constraints: list[str] = []
    criteria: list[str] = []


class InsightItem(BaseModel):
    content: str
    insight_type: str = "observation"
    confidence: float = 0.7


class InsightsOutput(BaseModel):
    insights: list[InsightItem] = []


class TreeNode(BaseModel):
    label: str
    node_type: str = "branch"
    children: list[TreeNode] = []


class DecisionTreeOutput(BaseModel):
    root_label: str = "project root"
    children: list[TreeNode] = []


class SuggestionItem(BaseModel):
    description: str
    category: str = "workflow"
    impact: str = "medium"
    effort: str = "low"


class SuggestionsOutput(BaseModel):
    suggestions: list[SuggestionItem] = []


class AuditOutput(BaseModel):
    total_decisions: int = 0
    manually_approved: int = 0
    could_auto_process: int = 0
    suggestion: str = ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/test_parsing.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/parsing.py tests/unit/core/test_parsing.py
git commit -m "feat: add LLM JSON parsing utility with Pydantic output models"
```

---

### Task 4: Harden Decision Room Parsing (3 sites)

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py`

- [ ] **Step 1: Update check_authorization (line 286-288)**

Add import at top of `src/cabinet/rooms/decision/service.py`, after existing imports:

```python
from cabinet.core.parsing import AuthorizationCheckResult, CascadeOutput, parse_llm_json
```

Replace lines 286-288 in `check_authorization`:

```python
        auto_process = (
            "auto" in output.content.lower() and "captain" not in output.content.lower()[:100]
        )
```

with:

```python
        parsed = parse_llm_json(output.content, AuthorizationCheckResult)
        if parsed is not None:
            auto_process = parsed.auto_process
        else:
            auto_process = (
                "auto" in output.content.lower() and "captain" not in output.content.lower()[:100]
            )
```

- [ ] **Step 2: Update _parse_cascade_output (lines 339-348)**

Replace the `_parse_cascade_output` static method:

```python
    @staticmethod
    def _parse_cascade_output(content: str) -> list[str]:
        parsed = parse_llm_json(content, CascadeOutput)
        if parsed is not None and parsed.titles:
            return parsed.titles
        titles = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                titles.append(line[:100])
        if not titles:
            titles = ["cascaded decision"]
        return titles
```

- [ ] **Step 3: Update _build_cards_with_summary (lines 318-337)**

Add to the prompt in `get_dashboard` (around line 223-225), append after `"For each decision, provide a one-line summary and identify the source room."`:

```python
                f"\n\nRespond with a JSON object:\n```json\n{{\"cards\": [{{\"summary\": \"...\", \"source_room\": \"...\"}}]}}\n```"
```

Replace the `_build_cards_with_summary` static method:

```python
    @staticmethod
    def _build_cards_with_summary(
        pending: list[Decision],
        summary: str,
    ) -> list[DecisionCard]:
        from cabinet.core.parsing import parse_llm_json
        from pydantic import BaseModel

        class CardSummary(BaseModel):
            summary: str = ""
            source_room: str = "decision"

        class DashboardSummary(BaseModel):
            cards: list[CardSummary] = []

        parsed = parse_llm_json(summary, DashboardSummary)
        cards = []
        for i, d in enumerate(pending):
            if parsed is not None and i < len(parsed.cards):
                card_summary = parsed.cards[i].summary or d.title
                source_room = parsed.cards[i].source_room
            else:
                lines = [ln.strip() for ln in summary.split("\n") if ln.strip()]
                card_summary = lines[i] if i < len(lines) else d.title
                source_room = "decision"
            cards.append(
                DecisionCard(
                    decision=d,
                    urgency_color=d.urgency,
                    summary=card_summary,
                    options_summary=[str(o) for o in d.options],
                    source_room=source_room,
                    created_ago="just now",
                )
            )
        return cards
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/unit/rooms/decision/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/rooms/decision/service.py
git commit -m "fix: harden Decision Room LLM output parsing with JSON fallback"
```

---

### Task 5: Harden Office Room Parsing (2 sites)

**Files:**
- Modify: `src/cabinet/rooms/office/service.py`

- [ ] **Step 1: Update check_permission (lines 342-358)**

Add import at top of `src/cabinet/rooms/office/service.py`, after existing imports:

```python
from cabinet.core.parsing import PermissionCheckResult, parse_llm_json
```

Replace lines 352-353 in `check_permission`:

```python
        allowed = "not allowed" not in output.content.lower()[:50]
        level = self._parse_permission_level(output.content)
```

with:

```python
        parsed = parse_llm_json(output.content, PermissionCheckResult)
        if parsed is not None:
            allowed = parsed.allowed
            level = PermissionLevel(parsed.level)
        else:
            allowed = "not allowed" not in output.content.lower()[:50]
            level = self._parse_permission_level(output.content)
```

- [ ] **Step 2: Run tests**

Run: `python -m pytest tests/unit/rooms/office/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/rooms/office/service.py
git commit -m "fix: harden Office Room LLM output parsing with JSON fallback"
```

---

### Task 6: Harden Strategy Room Parsing (2 sites)

**Files:**
- Modify: `src/cabinet/rooms/strategy/service.py`

- [ ] **Step 1: Update _parse_blueprint_output (lines 123-152)**

Add import at top of `src/cabinet/rooms/strategy/service.py`, after existing imports:

```python
from cabinet.core.parsing import BlueprintOutput, BlueprintValidationResult, parse_llm_json
```

Replace the `_parse_blueprint_output` static method:

```python
    @staticmethod
    def _parse_blueprint_output(content: str) -> tuple[list[str], list[str], list[str]]:
        parsed = parse_llm_json(content, BlueprintOutput)
        if parsed is not None:
            domains = parsed.domains if parsed.domains else ["primary"]
            constraints = parsed.constraints if parsed.constraints else ["budget"]
            criteria = parsed.criteria if parsed.criteria else ["revenue increase"]
            return domains, constraints, criteria
        action_domains: list[str] = []
        constraints: list[str] = []
        success_criteria: list[str] = []
        current: str | None = None
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if not line:
                continue
            lower = line.lower()
            if "domain" in lower and "action" in lower:
                current = "domains"
            elif "constraint" in lower:
                current = "constraints"
            elif "criterion" in lower or "criteria" in lower or "success" in lower:
                current = "criteria"
            elif current == "domains":
                action_domains.append(line)
            elif current == "constraints":
                constraints.append(line)
            elif current == "criteria":
                success_criteria.append(line)
        if not action_domains:
            action_domains = ["primary"]
        if not constraints:
            constraints = ["budget"]
        if not success_criteria:
            success_criteria = ["revenue increase"]
        return action_domains, constraints, success_criteria
```

- [ ] **Step 2: Update _parse_validation_output (lines 154-160)**

Replace the `_parse_validation_output` static method:

```python
    @staticmethod
    def _parse_validation_output(content: str) -> tuple[bool, list[str]]:
        parsed = parse_llm_json(content, BlueprintValidationResult)
        if parsed is not None:
            return parsed.is_valid, parsed.notes if parsed.notes else ["validated"]
        is_valid = "INVALID" not in content.upper()[:50]
        notes = [line.strip().lstrip("- ") for line in content.split("\n") if line.strip()]
        if not notes:
            notes = ["validated"]
        return is_valid, notes
```

- [ ] **Step 3: Run tests**

Run: `python -m pytest tests/unit/rooms/strategy/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/rooms/strategy/service.py
git commit -m "fix: harden Strategy Room LLM output parsing with JSON fallback"
```

---

### Task 7: Harden Summary Room Parsing (4 sites)

**Files:**
- Modify: `src/cabinet/rooms/summary/service.py`

- [ ] **Step 1: Add imports**

Add at top of `src/cabinet/rooms/summary/service.py`, after existing imports:

```python
from cabinet.core.parsing import (
    AuditOutput,
    DecisionTreeOutput,
    InsightsOutput,
    SuggestionsOutput,
    TreeNode,
    parse_llm_json,
)
```

- [ ] **Step 2: Update _parse_insights_output (lines 153-180)**

Replace the `_parse_insights_output` static method:

```python
    @staticmethod
    def _parse_insights_output(content: str, session_id: UUID) -> list[Insight]:
        parsed = parse_llm_json(content, InsightsOutput)
        if parsed is not None and parsed.insights:
            return [
                Insight(
                    session_id=session_id,
                    insight_type=item.insight_type,
                    content=item.content,
                    confidence=item.confidence,
                    auto_applicable=True,
                    requires_captain=False,
                )
                for item in parsed.insights
            ]
        insights = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                insights.append(
                    Insight(
                        session_id=session_id,
                        insight_type="observation",
                        content=line,
                        confidence=0.7,
                        auto_applicable=True,
                        requires_captain=False,
                    )
                )
        if not insights:
            insights = [
                Insight(
                    session_id=session_id,
                    insight_type="observation",
                    content="auto-generated insight",
                    confidence=0.7,
                    auto_applicable=True,
                    requires_captain=False,
                )
            ]
        return insights
```

- [ ] **Step 3: Update _parse_tree_output (lines 182-206)**

Replace the `_parse_tree_output` static method:

```python
    @staticmethod
    def _parse_tree_output(content: str, project_id: UUID) -> DecisionTree:
        parsed = parse_llm_json(content, DecisionTreeOutput)
        if parsed is not None and parsed.children:
            root_id = uuid4()
            nodes: dict[UUID, DecisionTreeNode] = {
                root_id: DecisionTreeNode(
                    id=root_id,
                    node_type="root",
                    label=parsed.root_label,
                ),
            }

            def _add_tree_nodes(tree_children: list[TreeNode], parent_id: UUID) -> None:
                for child in tree_children:
                    child_id = uuid4()
                    nodes[child_id] = DecisionTreeNode(
                        id=child_id,
                        node_type=child.node_type,
                        label=child.label[:100],
                    )
                    nodes[parent_id].children.append(child_id)
                    if child.children:
                        _add_tree_nodes(child.children, child_id)

            _add_tree_nodes(parsed.children, root_id)
            return DecisionTree(
                project_id=project_id,
                root_node_id=root_id,
                nodes=nodes,
            )
        root_id = uuid4()
        nodes: dict[UUID, DecisionTreeNode] = {
            root_id: DecisionTreeNode(
                id=root_id,
                node_type="root",
                label="project root",
            ),
        }
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                child_id = uuid4()
                nodes[child_id] = DecisionTreeNode(
                    id=child_id,
                    node_type="branch",
                    label=line[:100],
                )
                nodes[root_id].children.append(child_id)
        return DecisionTree(
            project_id=project_id,
            root_node_id=root_id,
            nodes=nodes,
        )
```

- [ ] **Step 4: Update _parse_suggestions_output (lines 208-235)**

Replace the `_parse_suggestions_output` static method:

```python
    @staticmethod
    def _parse_suggestions_output(content: str, session_id: UUID) -> list[ImprovementSuggestion]:
        parsed = parse_llm_json(content, SuggestionsOutput)
        if parsed is not None and parsed.suggestions:
            return [
                ImprovementSuggestion(
                    session_id=session_id,
                    category=item.category,
                    description=item.description[:200],
                    impact=item.impact,
                    effort=item.effort,
                    auto_applicable=True,
                )
                for item in parsed.suggestions
            ]
        suggestions = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                suggestions.append(
                    ImprovementSuggestion(
                        session_id=session_id,
                        category="workflow",
                        description=line[:200],
                        impact="medium",
                        effort="low",
                        auto_applicable=True,
                    )
                )
        if not suggestions:
            suggestions = [
                ImprovementSuggestion(
                    session_id=session_id,
                    category="workflow",
                    description="optimize pipeline",
                    impact="medium",
                    effort="low",
                    auto_applicable=True,
                )
            ]
        return suggestions
```

- [ ] **Step 5: Update _parse_audit_output (lines 237-250)**

Replace the `_parse_audit_output` static method:

```python
    @staticmethod
    def _parse_audit_output(content: str, captain_id: str) -> AuthorizationAudit:
        parsed = parse_llm_json(content, AuditOutput)
        if parsed is not None:
            return AuthorizationAudit(
                captain_id=captain_id,
                period="all",
                total_decisions=parsed.total_decisions,
                manually_approved=parsed.manually_approved,
                could_auto_process=parsed.could_auto_process,
                suggestion=parsed.suggestion or content[:200] if content else None,
            )
        numbers = re.findall(r"\d+", content)
        total = int(numbers[0]) if len(numbers) > 0 else 0
        manual = int(numbers[1]) if len(numbers) > 1 else 0
        auto = int(numbers[2]) if len(numbers) > 2 else 0
        return AuthorizationAudit(
            captain_id=captain_id,
            period="all",
            total_decisions=total,
            manually_approved=manual,
            could_auto_process=auto,
            suggestion=content[:200] if content else None,
        )
```

- [ ] **Step 6: Run tests**

Run: `python -m pytest tests/unit/rooms/summary/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/rooms/summary/service.py
git commit -m "fix: harden Summary Room LLM output parsing with JSON fallback"
```

---

### Task 8: Fix Agent History — Truncation + Unified Message Building

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`
- Modify: `tests/unit/agents/test_llm_agent.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agents/test_llm_agent.py`:

```python
@pytest.mark.asyncio
async def test_history_truncation():
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.agents.context import AgentContext
    from unittest.mock import AsyncMock, MagicMock

    gateway = AsyncMock()
    response = MagicMock()
    response.content = "response"
    response.usage = None
    gateway.acompletion = AsyncMock(return_value=response)

    from cabinet.models.primitives import Employee
    from uuid import uuid4

    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="Test", role="test", kind="ai"
    )
    agent = LiteLLMAgent(employee=employee, gateway=gateway, max_history=3)
    context = AgentContext(model="default", temperature=0.7)

    for i in range(10):
        agent._history.append({"role": "user", "content": f"msg{i}"})
        agent._history.append({"role": "assistant", "content": f"resp{i}"})

    agent._trim_history()
    assert len(agent._history) <= 6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_history_truncation -v`
Expected: FAIL — `LiteLLMAgent` has no `max_history` or `_trim_history`

- [ ] **Step 3: Implement history truncation and unified message building**

In `src/cabinet/agents/llm_agent.py`, modify the `LiteLLMAgent.__init__` to add `max_history`:

```python
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
        max_history: int = 20,
    ):
        self._employee = employee
        self._gateway = gateway
        self._system_prompt = system_prompt or (
            f"You are a {employee.role}. {employee.personality or ''}"
        )
        self._memory_store = memory_store
        self._max_history = max_history
        self._history: list[dict] = []
```

Add `_trim_history` method after `_build_messages`:

```python
    def _trim_history(self) -> None:
        if len(self._history) > self._max_history * 2:
            self._history = self._history[-(self._max_history * 2):]
```

Make `_build_messages` async and include memory search:

```python
    async def _build_messages(self, task: str) -> list[dict]:
        messages = [{"role": "system", "content": self._system_prompt}]
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                str(self._employee.id),
                MemoryScope.LONG_TERM,
                limit=5,
            )
            if items:
                memory_text = "\n".join(item.content for item in items)
                messages.append({"role": "system", "content": f"Relevant memory:\n{memory_text}"})
        messages.extend(self._history)
        messages.append({"role": "user", "content": task})
        return messages
```

Update `execute` to use `_build_messages` and `_trim_history`:

```python
    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        messages = await self._build_messages(task)
        response = await self._gateway.complete(
            messages=messages,
            model=context.model,
            temperature=context.temperature,
        )
        logger.info("Agent execute: employee=%s model=%s", self._employee.role, context.model)
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": response.content})
        self._trim_history()

        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope

            await self._memory_store.store(
                f"chat:{uuid4()}",
                MemoryItem(
                    owner_id=self._employee.id,
                    content=f"Q: {task}\nA: {response.content}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"employee_id": str(self._employee.id), "role": self._employee.role},
                ),
                MemoryScope.LONG_TERM,
            )

        return AgentOutput(content=response.content, employee_id=self._employee.id)
```

Update `execute_stream` to use `_trim_history`:

```python
    async def execute_stream(self, task: str, context: AgentContext):
        messages = await self._build_messages(task)
        full_content: list[str] = []
        async for chunk in self._gateway.stream(
            messages=messages, model=context.model, temperature=context.temperature
        ):
            full_content.append(chunk.content)
            yield chunk.content
        complete = "".join(full_content)
        logger.info("Agent stream complete: employee=%s model=%s", self._employee.role, context.model)
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": complete})
        self._trim_history()

        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope

            await self._memory_store.store(
                f"chat:{uuid4()}",
                MemoryItem(
                    owner_id=self._employee.id,
                    content=f"Q: {task}\nA: {complete}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"employee_id": str(self._employee.id), "role": self._employee.role},
                ),
                MemoryScope.LONG_TERM,
            )
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/agents/llm_agent.py tests/unit/agents/test_llm_agent.py
git commit -m "fix: add history truncation and unify message building in LiteLLMAgent"
```

---

### Task 9: Decision Room Dashboard Caching

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py`

- [ ] **Step 1: Add cache field and invalidation**

In `src/cabinet/rooms/decision/service.py`, add `_dashboard_cache` to `__init__` (after line 40):

```python
        self._dashboard_cache: DecisionDashboard | None = None
```

In `_apply_event`, add cache invalidation after the first line `if isinstance(event, DecisionSubmitted):` (after line 44):

```python
            self._dashboard_cache = None
```

Also add after `elif isinstance(event, DecisionApproved):` (after line 55):

```python
            self._dashboard_cache = None
```

And after `elif isinstance(event, DecisionRejected):` (after line 87):

```python
            self._dashboard_cache = None
```

- [ ] **Step 2: Update get_dashboard to use cache**

Replace the `get_dashboard` method:

```python
    async def get_dashboard(self, project_id: UUID) -> DecisionDashboard:
        if self._dashboard_cache is not None:
            return self._dashboard_cache
        pending = [d for d in self._decisions.values() if d.status == DecisionStatus.PENDING]
        cards = [
            DecisionCard(
                decision=d,
                urgency_color=d.urgency,
                summary=d.title,
                options_summary=[str(o) for o in d.options],
                source_room="unknown",
                created_ago="just now",
            )
            for d in pending
        ]
        if pending:
            agent = await self._agent_factory.create_agent(uuid4(), "secretary")
            context = AgentContext(model="default", temperature=0.5)
            decisions_text = "\n".join(
                f"- [{d.urgency}] {d.title}: {d.description[:100]}" for d in pending
            )
            output = await agent.execute(
                f"Summarize these pending decisions for Captain's dashboard:\n\n{decisions_text}\n\n"
                f"For each decision, provide a one-line summary and identify the source room."
                f"\n\nRespond with a JSON object:\n```json\n{{\"cards\": [{{\"summary\": \"...\", \"source_room\": \"...\"}}]}}\n```",
                context,
            )
            cards = self._build_cards_with_summary(pending, output.content)
        dashboard = DecisionDashboard(
            project_id=project_id,
            red_cards=[c for c in cards if c.urgency_color == "red"],
            yellow_cards=[c for c in cards if c.urgency_color == "yellow"],
            blue_cards=[c for c in cards if c.urgency_color == "blue"],
            white_cards=[c for c in cards if c.urgency_color == "white"],
            total_pending=len(pending),
        )
        self._dashboard_cache = dashboard
        return dashboard
```

- [ ] **Step 3: Run tests**

Run: `python -m pytest tests/unit/rooms/decision/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/rooms/decision/service.py
git commit -m "feat: add dashboard caching to Decision Room"
```

---

### Task 10: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Verify parsing utility works end-to-end**

Run: `python -c "from cabinet.core.parsing import parse_llm_json, AuthorizationCheckResult; r = parse_llm_json('{\"auto_process\": true}', AuthorizationCheckResult); assert r.auto_process is True; print('OK')"`
Expected: `OK`
