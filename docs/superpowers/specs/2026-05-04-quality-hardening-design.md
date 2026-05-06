# Quality Fix & Production Hardening Design

**Date**: 2026-05-04
**Status**: Approved
**Scope**: Fix failing test, streaming safety net, LLM output parsing hardening, agent history fix, decision persistence

## Overview

Three-layer approach to improve Cabinet's reliability and production readiness:

1. **Foundation Fix** — Fix failing test + streaming response safety net
2. **Core Hardening** — LLM output parsing (11 sites) + Agent history truncation/consistency
3. **Persistence** — Decision Room event recovery + dashboard caching

---

## Layer 1: Foundation Fix

### 1.1 Fix Failing Test `test_serve_creates_memory_store`

**Problem**: Test calls `_init_runtime` directly without mocking external dependencies (LiteLLM, ChromaDB, filesystem).

**Solution**: Rewrite test with proper mocking:
- Mock `LiteLLMRouterGateway` to avoid real LLM calls
- Set `memory_type="sqlite"` to avoid ChromaDB dependency
- Create required filesystem artifacts (cabinet.json, employees.json, models.json)
- Mock `runtime.start()` to avoid initialization side effects

### 1.2 Streaming Response Safety Net

**Problem**: `StreamingSecretaryResponse.finalize()` may be skipped (client disconnect, exception, forgotten call), causing events and conversation history to be lost.

**Solution**: Make `StreamingSecretaryResponse` an async context manager with automatic finalization:

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

Key properties:
- **Idempotent**: `finalize()` can be called multiple times safely
- **Exception-safe**: Internal errors are caught and silenced (stream already sent)
- **Auto-cleanup**: `__aexit__` guarantees finalization even on exception

Callers should use `async with` pattern:
```python
async with response:
    async for chunk in response.stream:
        yield chunk
```

Existing callers that explicitly call `finalize()` continue to work (backward compatible).

---

## Layer 2: Core Hardening

### 2.1 LLM Output Parsing Hardening

**Problem**: 11 sites across 4 Room services use simple string matching to parse LLM free-text output. Fragile and error-prone.

**Solution**: Create a JSON-based parsing utility with Pydantic models and graceful fallback.

#### Parsing Utility

**File**: `src/cabinet/core/parsing.py`

```python
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
```

#### Pydantic Output Models

**File**: `src/cabinet/core/parsing.py` (same file)

```python
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
    children: list["TreeNode"] = []

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

#### Prompt Modification Strategy

For each LLM call that needs structured output, append a JSON format instruction to the prompt:

```
Respond with a JSON object in this format:
```json
{"auto_process": true/false, "reason": "..."}
```
```

#### Fallback Strategy

Each parsing site follows this pattern:

```python
result = parse_llm_json(output.content, AuthorizationCheckResult)
if result is not None:
    auto_process = result.auto_process
else:
    # Original string matching logic as fallback
    auto_process = "auto" in output.content.lower() and "captain" not in output.content.lower()[:100]
```

This ensures backward compatibility — if JSON parsing fails, the original logic still runs.

#### Sites to Modify

| # | File | Method | Current Logic | New Model |
|---|------|--------|---------------|-----------|
| 1 | decision/service.py:286 | `check_authorization` | `"auto" in content.lower()` | `AuthorizationCheckResult` |
| 2 | decision/service.py:340 | `_parse_cascade_output` | Line-by-line | `CascadeOutput` |
| 3 | decision/service.py:319 | `_build_cards_with_summary` | Line-index matching | Prompt for JSON list |
| 4 | office/service.py:352 | `check_permission` | `"not allowed" not in content[:50]` | `PermissionCheckResult` |
| 5 | office/service.py:361 | `_parse_permission_level` | `re.search(r"L([0-3])")` | Part of `PermissionCheckResult` |
| 6 | strategy/service.py:155 | `_parse_validation_output` | `"INVALID" not in content[:50]` | `BlueprintValidationResult` |
| 7 | strategy/service.py:124 | `_parse_blueprint_output` | Keyword state machine | `BlueprintOutput` |
| 8 | summary/service.py:154 | `_parse_insights_output` | Line-by-line with hardcoded fields | `InsightsOutput` |
| 9 | summary/service.py:183 | `_parse_tree_output` | Flat line-by-line | `DecisionTreeOutput` |
| 10 | summary/service.py:209 | `_parse_suggestions_output` | Line-by-line with hardcoded fields | `SuggestionsOutput` |
| 11 | summary/service.py:238 | `_parse_audit_output` | `re.findall(r"\d+")` | `AuditOutput` |

### 2.2 Agent History Fix

**Problem**: `_history` grows unbounded (token explosion) + `execute` and `execute_stream` have inconsistent message building.

**Solution**:

1. Add `max_history` parameter (default 20) to `LiteLLMAgent.__init__`
2. Truncate `_history` after each execute call, keeping the most recent entries
3. Unify message building: both `execute` and `execute_stream` use `_build_messages`
4. Move memory_store search injection into `_build_messages`

```python
class LiteLLMAgent:
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
        max_history: int = 20,
    ):
        ...
        self._max_history = max_history

    def _trim_history(self) -> None:
        if len(self._history) > self._max_history * 2:
            self._history = self._history[-(self._max_history * 2):]

    def _build_messages(self, task: str) -> list[dict]:
        messages = [{"role": "system", "content": self._system_prompt}]
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope
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

Note: `_build_messages` needs to become async to support memory_store search. Both `execute` and `execute_stream` will call `await self._build_messages(task)`.

---

## Layer 3: Persistence

### 3.1 Decision Room Event Recovery

**Problem**: `_decisions` and `_rules` are in-memory dicts, lost on restart. `EventSourcedRoom.restore_from_events()` exists but Decision Room doesn't implement proper `_apply_event` to rebuild state.

**Solution**: Implement `_apply_event` in `DecisionRoomService` to handle DecisionSubmitted, DecisionApproved, DecisionRejected, DecisionDelegated, DecisionCascaded, AuthorizationSet events. Each event type updates `_decisions` or `_rules` accordingly.

### 3.2 Dashboard Caching

**Problem**: `get_dashboard()` triggers LLM call every time, expensive and inconsistent.

**Solution**: Add `_dashboard_cache` field. Cache the dashboard result. Invalidate cache when decisions change (new submission, status change). Return cached result when available.

---

## Execution Order

```
Layer 1 (Foundation Fix)
    ↓ verify tests pass + streaming safe
Layer 2 (Core Hardening)
    ↓ verify LLM parsing + agent history fixed
Layer 3 (Persistence)
    ↓ verify decision recovery + dashboard caching
```

Each layer produces a verifiable deliverable before the next begins.
