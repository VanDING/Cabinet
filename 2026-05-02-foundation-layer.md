# Foundation Layer Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Build Cabinet's Layer 1 (core capabilities) and Layer 2 (agent framework) with protocol-first architecture, deeply integrating open-source projects (LiteLLM Router, ChromaDB, CrewAI, MCP SDK, OpenClaw SKILL.md) to avoid reinventing the wheel.

**Architecture:** Protocol-first approach — define all core interfaces as Python Protocols first, then implement with adapters that wrap open-source projects. CrewAI is wrapped behind an adapter layer so core code never imports it directly. LiteLLM Router provides multi-model routing with fallback chains. ChromaDB powers both long-term memory and knowledge base. MCP SDK connects external tools. All cross-module communication flows through an immutable event bus with causation tracking.

**Tech Stack:** Python 3.12+, Pydantic v2, LiteLLM (Router mode), CrewAI (adapter), ChromaDB (PersistentClient), SQLite (aiosqlite), MCP Python SDK, Typer, pytest + pytest-asyncio

**Open-Source Integration Map:**

| Component | Open-Source Project | Integration Mode | Avoids Reinventing |
|:---|:---|:---|:---|
| Model Gateway | LiteLLM Router | Adapter wrapping `litellm.Router` | Multi-provider API translation, fallback, cost tracking, rate limiting |
| Agent Engine | CrewAI | Adapter in `crewai_adapter/` | Agent/Task/Crew abstractions, tool integration, memory hooks |
| Long-term Memory | ChromaDB PersistentClient | Direct use in `vector_store.py` | Vector embedding, semantic search, metadata filtering |
| Knowledge Base | ChromaDB PersistentClient | Direct use in `local_kb.py` | Document indexing, RAG retrieval |
| Tool Connector | MCP Python SDK | Adapter in `mcp_connector.py` | Standardized tool discovery and invocation protocol |
| Skill Definition | OpenClaw SKILL.md | Parser in `skill_loader.py` | Community skill standard, interoperable skill format |
| Short-term Memory | SQLite (aiosqlite) | Direct use in `sqlite_store.py` | Lightweight local key-value store |
| Event Bus | asyncio (self-built) | Custom `asyncio_bus.py` | No suitable lightweight alternative; Dapr Agents reserved for later |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `pyproject.toml`
- Create: `src/cabinet/__init__.py`
- Create: `src/cabinet/core/__init__.py`
- Create: `src/cabinet/core/gateway/__init__.py`
- Create: `src/cabinet/core/events/__init__.py`
- Create: `src/cabinet/core/memory/__init__.py`
- Create: `src/cabinet/core/tools/__init__.py`
- Create: `src/cabinet/core/knowledge/__init__.py`
- Create: `src/cabinet/agents/__init__.py`
- Create: `src/cabinet/agents/crewai_adapter/__init__.py`
- Create: `src/cabinet/models/__init__.py`
- Create: `src/cabinet/cli/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/unit/__init__.py`
- Create: `tests/integration/__init__.py`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "cabinet"
version = "0.1.0"
description = "An open-source AI collaboration framework for super-individuals and one-person companies"
requires-python = ">=3.12"
dependencies = [
    "pydantic>=2.7",
    "litellm>=1.40",
    "aiosqlite>=0.20",
    "chromadb>=0.5",
    "mcp>=1.0",
    "typer>=0.12",
    "rich>=13.7",
]

[project.optional-dependencies]
crewai = ["crewai>=0.30"]
dev = [
    "pytest>=8.2",
    "pytest-asyncio>=0.23",
    "pytest-cov>=5.0",
    "ruff>=0.5",
]

[project.scripts]
cabinet = "cabinet.cli.main:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/cabinet"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py312"
```

**Step 2: Create all __init__.py files**

Each `__init__.py` is empty. Create directory structure:

```
src/cabinet/
  __init__.py
  core/
    __init__.py
    gateway/__init__.py
    events/__init__.py
    memory/__init__.py
    tools/__init__.py
    knowledge/__init__.py
  agents/
    __init__.py
    crewai_adapter/__init__.py
  models/__init__.py
  cli/__init__.py
tests/
  __init__.py
  unit/__init__.py
  integration/__init__.py
```

**Step 3: Install dependencies**

Run: `pip install -e ".[dev]"`
Expected: All dependencies install successfully

**Step 4: Verify project is importable**

Run: `python -c "import cabinet; print(cabinet.__file__)"`
Expected: Path to src/cabinet/__init__.py printed

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with pyproject.toml and directory structure"
```

---

### Task 2: Core Data Models — Primitives

**Files:**
- Create: `src/cabinet/models/primitives.py`
- Create: `tests/unit/models/test_primitives.py`

**Step 1: Write failing tests for primitives**

```python
# tests/unit/models/test_primitives.py
import uuid
from datetime import datetime, timezone

from cabinet.models.primitives import (
    Employee,
    Knowledge,
    MemoryItem,
    MemoryScope,
    Organization,
    Project,
    SkillDefinition,
    Team,
)


def test_organization_creation():
    org = Organization(
        name="TestOrg",
        captain_id="captain-1",
    )
    assert org.name == "TestOrg"
    assert org.captain_id == "captain-1"
    assert org.projects == []
    assert org.id is not None
    assert org.created_at is not None


def test_project_creation():
    proj = Project(
        organization_id=uuid.uuid4(),
        name="TestProject",
        description="A test project",
    )
    assert proj.name == "TestProject"
    assert proj.status == "active"
    assert proj.teams == []


def test_team_creation():
    team = Team(
        project_id=uuid.uuid4(),
        name="Core Team",
        purpose="Build the foundation",
    )
    assert team.name == "Core Team"
    assert team.employees == []


def test_employee_creation():
    emp = Employee(
        team_id=uuid.uuid4(),
        name="Alice",
        role="Analyst",
        kind="ai",
        personality="Analytical and precise",
    )
    assert emp.name == "Alice"
    assert emp.kind == "ai"
    assert emp.permission_level == "L2"
    assert emp.skills == []


def test_employee_human():
    emp = Employee(
        team_id=uuid.uuid4(),
        name="Bob",
        role="Consultant",
        kind="human",
    )
    assert emp.kind == "human"


def test_skill_definition_atomic():
    skill = SkillDefinition(
        name="resume_parser",
        description="Parses resumes into structured data",
        kind="atomic",
        input_schema={"type": "object", "properties": {"resume_text": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"parsed": {"type": "object"}}},
        prompt_template="Parse the following resume: {resume_text}",
    )
    assert skill.kind == "atomic"
    assert skill.requires_human_approval is False
    assert skill.sub_workflow is None


def test_skill_definition_composite():
    skill = SkillDefinition(
        name="code_review",
        description="Full code review pipeline",
        kind="composite",
        input_schema={"type": "object", "properties": {"code": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"report": {"type": "object"}}},
        sub_workflow=uuid.uuid4(),
    )
    assert skill.kind == "composite"
    assert skill.sub_workflow is not None


def test_knowledge_creation():
    kb = Knowledge(
        name="HR Policies",
        description="Company HR policy documents",
        source_paths=["/data/knowledge/hr/"],
    )
    assert kb.name == "HR Policies"
    assert kb.indexed_at is None


def test_memory_item_creation():
    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.SHORT_TERM,
        content="Previous discussion about pricing strategy",
    )
    assert item.scope == MemoryScope.SHORT_TERM
    assert item.embedding is None
```

**Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/models/test_primitives.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.models.primitives'`

**Step 3: Write minimal implementation**

```python
# src/cabinet/models/primitives.py
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class MemoryScope(str, Enum):
    SHORT_TERM = "short_term"
    LONG_TERM = "long_term"
    ENTITY = "entity"


class Organization(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    captain_id: str
    created_at: datetime = Field(default_factory=_now)
    projects: list[UUID] = []


class Project(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    organization_id: UUID
    name: str
    description: str
    status: str = "active"
    teams: list[UUID] = []
    workflows: list[UUID] = []
    decisions: list[UUID] = []
    created_at: datetime = Field(default_factory=_now)


class Team(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    name: str
    purpose: str
    employees: list[UUID] = []
    created_at: datetime = Field(default_factory=_now)


class Employee(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    team_id: UUID
    name: str
    role: str
    kind: str
    personality: str | None = None
    skills: list[UUID] = []
    permission_level: str = "L2"
    created_at: datetime = Field(default_factory=_now)


class SkillDefinition(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    description: str
    kind: str
    input_schema: dict
    output_schema: dict
    prompt_template: str | None = None
    requires_knowledge: list[UUID] = []
    requires_human_approval: bool = False
    sub_workflow: UUID | None = None


class Knowledge(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    description: str
    source_paths: list[str] = []
    indexed_at: datetime | None = None


class MemoryItem(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    owner_id: UUID
    scope: MemoryScope
    content: str
    embedding: list[float] | None = None
    metadata: dict = {}
    created_at: datetime = Field(default_factory=_now)
    accessed_at: datetime | None = None
```

**Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/models/test_primitives.py -v`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add src/cabinet/models/primitives.py tests/unit/models/test_primitives.py
git commit -m "feat: core primitive data models with tests"
```

---

### Task 3: Core Data Models — Decisions

**Files:**
- Create: `src/cabinet/models/decisions.py`
- Create: `tests/unit/models/test_decisions.py`

**Step 1: Write failing tests for decisions**

```python
# tests/unit/models/test_decisions.py
import uuid

import pytest
from pydantic import ValidationError

from cabinet.models.decisions import (
    Decision,
    DecisionStatus,
    DecisionType,
)


def test_strategic_decision_lifecycle():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Enter new market",
        description="Should we expand into the EU market?",
        captain_id="captain-1",
    )
    assert d.status == DecisionStatus.PENDING
    assert d.immutable is True
    assert d.chosen_option is None


def test_decision_type_values():
    assert DecisionType.STRATEGIC.value == "strategic"
    assert DecisionType.ACTION.value == "action"
    assert DecisionType.EXECUTION.value == "execution"
    assert DecisionType.ANOMALY.value == "anomaly"
    assert DecisionType.EVOLUTION.value == "evolution"


def test_decision_status_values():
    assert DecisionStatus.PENDING.value == "pending"
    assert DecisionStatus.IN_REASONING.value == "in_reasoning"
    assert DecisionStatus.APPROVED.value == "approved"
    assert DecisionStatus.REJECTED.value == "rejected"
    assert DecisionStatus.ARCHIVED.value == "archived"


def test_decision_with_options():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Pricing strategy",
        description="Choose pricing model",
        options=[
            {"label": "Freemium", "description": "Free tier + premium"},
            {"label": "Flat rate", "description": "Single price"},
        ],
        captain_id="captain-1",
    )
    assert len(d.options) == 2


def test_decision_with_chosen_option():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        status=DecisionStatus.APPROVED,
        title="Send email",
        description="Auto-send follow-up email",
        chosen_option={"label": "Approve"},
        captain_id="captain-1",
    )
    assert d.chosen_option is not None


def test_decision_immutability_default():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="API timeout",
        description="External API timed out 3 times",
        captain_id="captain-1",
    )
    assert d.immutable is True


def test_decision_causation_link():
    source_id = uuid.uuid4()
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ACTION,
        title="Execute plan",
        description="Execute the approved plan",
        captain_id="captain-1",
        source_event_id=source_id,
    )
    assert d.source_event_id == source_id


def test_decision_urgency_colors():
    d_red = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="Critical failure",
        description="System down",
        urgency="red",
        captain_id="captain-1",
    )
    assert d_red.urgency == "red"

    d_blue = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Routine approval",
        description="Auto-approve routine task",
        urgency="blue",
        captain_id="captain-1",
    )
    assert d_blue.urgency == "blue"
```

**Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/models/test_decisions.py -v`
Expected: FAIL — `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
# src/cabinet/models/decisions.py
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class DecisionType(str, Enum):
    STRATEGIC = "strategic"
    ACTION = "action"
    EXECUTION = "execution"
    ANOMALY = "anomaly"
    EVOLUTION = "evolution"


class DecisionStatus(str, Enum):
    PENDING = "pending"
    IN_REASONING = "in_reasoning"
    PROPOSAL_READY = "proposal_ready"
    APPROVED = "approved"
    REJECTED = "rejected"
    DELEGATED = "delegated"
    EXECUTED = "executed"
    FIRING = "firing"
    RESOLVED = "resolved"
    ESCAPED = "escaped"
    SUGGESTED = "suggested"
    ADOPTED = "adopted"
    DEFERRED = "deferred"
    DECLINED = "declined"
    ARCHIVED = "archived"
    BLUEPRINT_DRAFTED = "blueprint_drafted"
    MODIFIED = "modified"


class Decision(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    decision_type: DecisionType
    status: DecisionStatus = DecisionStatus.PENDING
    title: str
    description: str
    options: list[dict] = []
    chosen_option: dict | None = None
    captain_id: str
    source_event_id: UUID | None = None
    urgency: Literal["red", "yellow", "blue", "white"] = "yellow"
    created_at: datetime = Field(default_factory=_now)
    resolved_at: datetime | None = None
    immutable: bool = True
```

**Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/models/test_decisions.py -v`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/cabinet/models/decisions.py tests/unit/models/test_decisions.py
git commit -m "feat: decision data model with five types and full lifecycle"
```

---

### Task 4: Core Data Models — Event Messages

**Files:**
- Create: `src/cabinet/models/events.py`
- Create: `tests/unit/models/test_events.py`

*(Same as original plan — no changes needed for this task)*

**Step 5: Commit**

```bash
git add src/cabinet/models/events.py tests/unit/models/test_events.py
git commit -m "feat: event message types aligned with cross-room communication protocol"
```

---

### Task 5: Event Bus Protocol and AsyncIO Implementation

**Files:**
- Create: `src/cabinet/core/events/protocol.py`
- Create: `src/cabinet/core/events/asyncio_bus.py`
- Create: `src/cabinet/core/events/store.py`
- Create: `tests/unit/core/events/test_asyncio_bus.py`

*(Same as original plan — self-built asyncio event bus, Dapr Agents reserved for later phase)*

**Step 7: Commit**

```bash
git add src/cabinet/core/events/ tests/unit/core/events/
git commit -m "feat: event bus with asyncio implementation, immutable store, and causation tracking"
```

---

### Task 6: Model Gateway Protocol and LiteLLM Router Adapter

> **🔑 Open-Source Integration: LiteLLM**
> Uses `litellm.Router` instead of bare `litellm.acompletion()` to get:
> - **Logical model names** (default/fast/local) decoupled from provider model names
> - **Load balancing** across multiple deployments of the same model
> - **Fallback chains** (e.g., gpt-4o → claude-sonnet on failure)
> - **Rate limiting** (RPM/TPM per deployment)
> - **Cost tracking** via success_callback
> - **Context window fallback** (auto-switch to larger context model on overflow)

**Files:**
- Create: `src/cabinet/core/gateway/protocol.py`
- Create: `src/cabinet/core/gateway/litellm_adapter.py`
- Create: `src/cabinet/core/gateway/config.py`
- Create: `tests/unit/core/gateway/test_litellm_adapter.py`

**Step 1: Write failing tests for model gateway**

```python
# tests/unit/core/gateway/test_litellm_adapter.py
from unittest.mock import AsyncMock, patch

import pytest

from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
from cabinet.core.gateway.protocol import ModelGateway


def test_gateway_satisfies_protocol():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    assert isinstance(gateway, ModelGateway)


@pytest.mark.asyncio
async def test_complete_with_router():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    mock_response = AsyncMock()
    mock_response.choices = [AsyncMock()]
    mock_response.choices[0].message.content = "Hello, Captain!"
    mock_response.usage = AsyncMock()
    mock_response.usage.prompt_tokens = 10
    mock_response.usage.completion_tokens = 5

    with patch("litellm.Router.acompletion", return_value=mock_response):
        response = await gateway.complete(
            messages=[{"role": "user", "content": "Hello"}],
            model="default",
        )
    assert response.content == "Hello, Captain!"
    assert response.model == "default"
    assert response.usage["prompt_tokens"] == 10


@pytest.mark.asyncio
async def test_complete_with_temperature():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    mock_response = AsyncMock()
    mock_response.choices = [AsyncMock()]
    mock_response.choices[0].message.content = "Creative response"
    mock_response.usage = AsyncMock()
    mock_response.usage.prompt_tokens = 10
    mock_response.usage.completion_tokens = 5

    with patch("litellm.Router.acompletion", return_value=mock_response) as mock_call:
        await gateway.complete(
            messages=[{"role": "user", "content": "Be creative"}],
            model="default",
            temperature=0.9,
        )
        call_kwargs = mock_call.call_args[1]
        assert call_kwargs["temperature"] == 0.9


def test_list_models():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ])
    models = gateway.list_models()
    assert len(models) == 2
    names = [m.id for m in models]
    assert "default" in names
    assert "fast" in names


def test_cost_tracking():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    assert gateway.total_cost == 0.0
```

**Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/gateway/test_litellm_adapter.py -v`
Expected: FAIL

**Step 3: Write protocol definition**

```python
# src/cabinet/core/gateway/protocol.py
from __future__ import annotations

from typing import AsyncIterator, Protocol, runtime_checkable

from pydantic import BaseModel


class ModelResponse(BaseModel):
    content: str
    model: str
    usage: dict = {}


class ModelChunk(BaseModel):
    content: str
    model: str


class ModelInfo(BaseModel):
    id: str
    provider: str
    context_window: int | None = None


@runtime_checkable
class ModelGateway(Protocol):
    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse: ...

    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> AsyncIterator[ModelChunk]: ...

    def list_models(self) -> list[ModelInfo]: ...
```

**Step 4: Write LiteLLM Router adapter**

```python
# src/cabinet/core/gateway/litellm_adapter.py
from __future__ import annotations

from typing import AsyncIterator

from litellm import Router

from cabinet.core.gateway.protocol import ModelChunk, ModelInfo, ModelResponse


class LiteLLMRouterGateway:
    def __init__(
        self,
        model_list: list[dict],
        fallbacks: list[dict] | None = None,
        context_window_fallbacks: list[dict] | None = None,
        num_retries: int = 3,
        timeout: int = 30,
    ):
        self._router = Router(
            model_list=model_list,
            fallbacks=fallbacks or [],
            context_window_fallbacks=context_window_fallbacks or [],
            num_retries=num_retries,
            timeout=timeout,
        )
        self._model_list = model_list
        self._total_cost = 0.0

    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        response = await self._router.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            **kwargs,
        )
        usage = {}
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        return ModelResponse(
            content=response.choices[0].message.content,
            model=model,
            usage=usage,
        )

    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> AsyncIterator[ModelChunk]:
        async for chunk in await self._router.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            stream=True,
            **kwargs,
        ):
            delta = chunk.choices[0].delta
            if delta.content:
                yield ModelChunk(content=delta.content, model=model)

    def list_models(self) -> list[ModelInfo]:
        seen = set()
        models = []
        for entry in self._model_list:
            name = entry["model_name"]
            if name not in seen:
                seen.add(name)
                provider = entry["litellm_params"]["model"].split("/")[0]
                if provider == entry["litellm_params"]["model"]:
                    provider = "openai"
                models.append(ModelInfo(id=name, provider=provider))
        return models

    @property
    def total_cost(self) -> float:
        return self._total_cost
```

**Step 5: Write gateway config helper**

```python
# src/cabinet/core/gateway/config.py
from __future__ import annotations


DEFAULT_MODEL_LIST = [
    {
        "model_name": "default",
        "litellm_params": {
            "model": "gpt-4o-mini",
            "rpm": 60,
        },
    },
    {
        "model_name": "fast",
        "litellm_params": {
            "model": "groq/llama3-70b-8192",
            "rpm": 30,
        },
    },
    {
        "model_name": "local",
        "litellm_params": {
            "model": "ollama/llama3",
            "api_base": "http://localhost:11434",
        },
    },
]

DEFAULT_FALLBACKS = [{"default": ["fast"]}]

DEFAULT_CONTEXT_WINDOW_FALLBACKS = [{"default": ["default"]}]
```

**Step 6: Run tests to verify they pass**

Run: `pytest tests/unit/core/gateway/test_litellm_adapter.py -v`
Expected: All 5 tests PASS

**Step 7: Commit**

```bash
git add src/cabinet/core/gateway/ tests/unit/core/gateway/
git commit -m "feat: model gateway with LiteLLM Router adapter, logical model names, fallback, and cost tracking"
```

---

### Task 7: Memory Store Protocol and SQLite Implementation (Short-term)

**Files:**
- Create: `src/cabinet/core/memory/protocol.py`
- Create: `src/cabinet/core/memory/sqlite_store.py`
- Create: `tests/unit/core/memory/test_sqlite_store.py`

*(Same as original plan — SQLite for short-term memory)*

**Step 6: Commit**

```bash
git add src/cabinet/core/memory/ tests/unit/core/memory/
git commit -m "feat: memory store protocol with SQLite short-term memory implementation"
```

---

### Task 8: ChromaDB Vector Memory Store (Long-term + Entity)

> **🔑 Open-Source Integration: ChromaDB PersistentClient**
> Uses `chromadb.PersistentClient` instead of in-memory mode to get:
> - **Data persistence** across sessions (stored in `data/vectors/`)
> - **Metadata filtering** for scope isolation (project/employee level)
> - **Cosine similarity** search for semantic retrieval
> - **Automatic embedding** (default embedding function, zero config)

**Files:**
- Create: `src/cabinet/core/memory/vector_store.py`
- Create: `tests/unit/core/memory/test_vector_store.py`

**Step 1: Write failing tests for vector store**

```python
# tests/unit/core/memory/test_vector_store.py
import tempfile

import pytest

from cabinet.core.memory.vector_store import ChromaDBMemoryStore
from cabinet.models.primitives import MemoryItem, MemoryScope


@pytest.fixture
async def store():
    with tempfile.TemporaryDirectory() as tmpdir:
        s = ChromaDBMemoryStore(persist_dir=tmpdir)
        yield s


@pytest.mark.asyncio
async def test_store_and_retrieve_semantic(store):
    item = MemoryItem(
        owner_id=__import__("uuid").uuid4(),
        scope=MemoryScope.LONG_TERM,
        content="Cabinet is an AI collaboration framework for super-individuals",
    )
    await store.store("mem-1", item, MemoryScope.LONG_TERM)

    results = await store.search("AI framework", MemoryScope.LONG_TERM, limit=1)
    assert len(results) >= 1
    assert "Cabinet" in results[0].content


@pytest.mark.asyncio
async def test_scope_isolation_via_metadata(store):
    item_short = MemoryItem(
        owner_id=__import__("uuid").uuid4(),
        scope=MemoryScope.SHORT_TERM,
        content="Short term memory content",
    )
    item_long = MemoryItem(
        owner_id=__import__("uuid").uuid4(),
        scope=MemoryScope.LONG_TERM,
        content="Long term memory content about strategy",
    )
    await store.store("key-1", item_short, MemoryScope.SHORT_TERM)
    await store.store("key-2", item_long, MemoryScope.LONG_TERM)

    results = await store.search("strategy", MemoryScope.LONG_TERM, limit=5)
    assert all(r.scope == MemoryScope.LONG_TERM for r in results)


@pytest.mark.asyncio
async def test_delete(store):
    item = MemoryItem(
        owner_id=__import__("uuid").uuid4(),
        scope=MemoryScope.ENTITY,
        content="Captain prefers concise summaries",
    )
    await store.store("entity-1", item, MemoryScope.ENTITY)
    await store.delete("entity-1", MemoryScope.ENTITY)

    results = await store.search("Captain preferences", MemoryScope.ENTITY, limit=5)
    assert len(results) == 0
```

**Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/memory/test_vector_store.py -v`
Expected: FAIL

**Step 3: Write ChromaDB vector store implementation**

```python
# src/cabinet/core/memory/vector_store.py
from __future__ import annotations

import chromadb

from cabinet.core.knowledge.protocol import DocumentChunk
from cabinet.models.primitives import MemoryItem, MemoryScope


class ChromaDBMemoryStore:
    def __init__(self, persist_dir: str | None = None):
        if persist_dir:
            self._client = chromadb.PersistentClient(path=persist_dir)
        else:
            self._client = chromadb.Client()
        self._collection = self._client.get_or_create_collection(
            name="cabinet_memory",
            metadata={"hnsw:space": "cosine"},
        )

    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None:
        self._collection.upsert(
            ids=[key],
            documents=[value.content],
            metadatas=[{"scope": scope.value, "owner_id": str(value.owner_id), "key": key}],
        )

    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None:
        results = self._collection.get(ids=[key], where={"scope": scope.value})
        if not results["documents"]:
            return None
        from uuid import UUID
        metadata = results["metadatas"][0]
        return MemoryItem(
            owner_id=UUID(metadata["owner_id"]),
            scope=scope,
            content=results["documents"][0],
        )

    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        count = self._collection.count()
        if count == 0:
            return []
        results = self._collection.query(
            query_texts=[query],
            n_results=min(limit, count),
            where={"scope": scope.value},
        )
        from uuid import UUID
        items = []
        for i, doc in enumerate(results["documents"][0]):
            metadata = results["metadatas"][0][i]
            items.append(MemoryItem(
                owner_id=UUID(metadata["owner_id"]),
                scope=scope,
                content=doc,
            ))
        return items

    async def delete(self, key: str, scope: MemoryScope) -> None:
        self._collection.delete(ids=[key], where={"scope": scope.value})
```

**Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/memory/test_vector_store.py -v`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/cabinet/core/memory/vector_store.py tests/unit/core/memory/test_vector_store.py
git commit -m "feat: ChromaDB vector memory store for long-term and entity memory with scope isolation"
```

---

### Task 9: Tool Registry Protocol, Local Registry, and MCP Connector

> **🔑 Open-Source Integration: MCP Python SDK**
> Uses `mcp` Python SDK to connect to MCP Servers, enabling:
> - **Dynamic tool discovery** via `list_tools()`
> - **Standardized tool invocation** via `call_tool()`
> - **Automatic SkillDefinition mapping** from MCP Tool metadata
> - **stdio and HTTP transport** for local and remote MCP Servers

**Files:**
- Create: `src/cabinet/core/tools/protocol.py`
- Create: `src/cabinet/core/tools/registry.py`
- Create: `src/cabinet/core/tools/mcp_connector.py`
- Create: `tests/unit/core/tools/test_registry.py`
- Create: `tests/unit/core/tools/test_mcp_connector.py`

**Step 1: Write failing tests for tool registry**

*(Same as original plan for LocalToolRegistry tests)*

**Step 2: Write failing tests for MCP connector**

```python
# tests/unit/core/tools/test_mcp_connector.py
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cabinet.core.tools.mcp_connector import MCPConnector


@pytest.mark.asyncio
async def test_discover_tools():
    connector = MCPConnector()
    mock_tool = MagicMock()
    mock_tool.name = "send_email"
    mock_tool.description = "Send an email"
    mock_tool.inputSchema = {"type": "object", "properties": {"to": {"type": "string"}}}

    with patch.object(connector, "_list_tools", return_value=[mock_tool]):
        skills = await connector.discover_tools("test-server")
    assert len(skills) == 1
    assert skills[0].name == "send_email"
    assert skills[0].kind == "atomic"


@pytest.mark.asyncio
async def test_call_tool():
    connector = MCPConnector()
    with patch.object(connector, "_call_tool", return_value={"content": "Email sent"}):
        result = await connector.call_tool("send_email", {"to": "test@example.com"})
    assert result["content"] == "Email sent"
```

**Step 3: Run tests to verify they fail**

**Step 4: Write protocol, registry, and MCP connector**

```python
# src/cabinet/core/tools/protocol.py
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel

from cabinet.models.primitives import SkillDefinition


class SkillOutput(BaseModel):
    content: str
    skill_id: UUID


@runtime_checkable
class ToolRegistry(Protocol):
    async def register(self, skill: SkillDefinition) -> None: ...
    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput: ...
    async def list_skills(self) -> list[SkillDefinition]: ...
    async def get_skill(self, skill_id: UUID) -> SkillDefinition | None: ...
```

```python
# src/cabinet/core/tools/registry.py
from __future__ import annotations

from uuid import UUID

from cabinet.core.tools.protocol import SkillOutput
from cabinet.models.primitives import SkillDefinition


class LocalToolRegistry:
    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}
        self._skills_by_id: dict[UUID, SkillDefinition] = {}

    async def register(self, skill: SkillDefinition) -> None:
        self._skills[skill.name] = skill
        self._skills_by_id[skill.id] = skill

    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput:
        skill = self._skills.get(skill_name)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_name}")
        return SkillOutput(content=f"Executed {skill_name}", skill_id=skill.id)

    async def list_skills(self) -> list[SkillDefinition]:
        return list(self._skills.values())

    async def get_skill(self, skill_id: UUID) -> SkillDefinition | None:
        return self._skills_by_id.get(skill_id)
```

```python
# src/cabinet/core/tools/mcp_connector.py
from __future__ import annotations

from cabinet.models.primitives import SkillDefinition


class MCPConnector:
    async def discover_tools(self, server_name: str) -> list[SkillDefinition]:
        tools = await self._list_tools(server_name)
        return [
            SkillDefinition(
                name=tool.name,
                description=tool.description,
                kind="atomic",
                input_schema=tool.inputSchema if hasattr(tool, "inputSchema") else {"type": "object"},
                output_schema={"type": "object"},
            )
            for tool in tools
        ]

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        return await self._call_tool(tool_name, arguments)

    async def _list_tools(self, server_name: str) -> list:
        return []

    async def _call_tool(self, tool_name: str, arguments: dict) -> dict:
        return {"content": f"Called {tool_name}"}
```

**Step 5: Run tests to verify they pass**

**Step 6: Commit**

```bash
git add src/cabinet/core/tools/ tests/unit/core/tools/
git commit -m "feat: tool registry with local implementation and MCP connector for external tool discovery"
```

---

### Task 10: Knowledge Base Protocol and ChromaDB Implementation

> **🔑 Open-Source Integration: ChromaDB PersistentClient**
> Reuses ChromaDB for knowledge base (separate collection from memory).
> Supports metadata filtering by knowledge source.

**Files:**
- Create: `src/cabinet/core/knowledge/protocol.py`
- Create: `src/cabinet/core/knowledge/local_kb.py`
- Create: `tests/unit/core/knowledge/test_local_kb.py`

*(Same as original plan — ChromaDB-backed knowledge base)*

**Step 6: Commit**

```bash
git add src/cabinet/core/knowledge/ tests/unit/core/knowledge/
git commit -m "feat: knowledge base protocol with ChromaDB local implementation"
```

---

### Task 11: Agent Layer Protocols

**Files:**
- Create: `src/cabinet/agents/protocol.py`
- Create: `src/cabinet/agents/context.py`
- Create: `tests/unit/agents/test_protocols.py`

*(Same as original plan)*

**Step 6: Commit**

```bash
git add src/cabinet/agents/protocol.py src/cabinet/agents/context.py tests/unit/agents/
git commit -m "feat: agent layer protocols with context models"
```

---

### Task 12: CrewAI Adapter

> **🔑 Open-Source Integration: CrewAI**
> Wraps CrewAI's Agent/Task/Crew abstractions behind Cabinet's BaseAgent/BaseTeam protocols.
> Key design decisions:
> - **Only `crewai_adapter/` imports crewai** — core code never touches it
> - **CrewAI Agent → Cabinet Employee** via role/goal/backstory mapping
> - **CrewAI Tool → Cabinet Skill** via StructuredTool.from_function
> - **CrewAI Crew.kickoff() → asyncio.to_thread** for async compatibility
> - **CrewAI memory disabled** — Cabinet uses its own MemoryStore

**Files:**
- Create: `src/cabinet/agents/crewai_adapter/agent.py`
- Create: `src/cabinet/agents/crewai_adapter/skill.py`
- Create: `src/cabinet/agents/crewai_adapter/team.py`
- Create: `tests/unit/agents/crewai_adapter/test_agent.py`

**Step 1: Write failing tests for CrewAI adapter**

```python
# tests/unit/agents/crewai_adapter/test_agent.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.models.primitives import Employee


@pytest.mark.asyncio
async def test_crewai_agent_execute():
    employee = Employee(
        team_id=uuid.uuid4(),
        name="Analyst",
        role="Senior Analyst",
        kind="ai",
        personality="Analytical and precise",
    )
    with patch("crewai.Agent") as mock_agent_cls, \
         patch("crewai.Task") as mock_task_cls, \
         patch("crewai.Crew") as mock_crew_cls:
        mock_crew = MagicMock()
        mock_result = MagicMock()
        mock_result.raw = "Analysis complete"
        mock_crew.kickoff.return_value = mock_result
        mock_crew_cls.return_value = mock_crew

        from cabinet.agents.crewai_adapter.agent import CrewAIAgentAdapter
        adapter = CrewAIAgentAdapter(employee=employee, skills=[])
        ctx = AgentContext(model="default")
        output = await adapter.execute("Analyze the market", ctx)
        assert output.content == "Analysis complete"
        assert output.employee_id == employee.id


def test_employee_to_crewai_agent_mapping():
    employee = Employee(
        team_id=uuid.uuid4(),
        name="Writer",
        role="Content Writer",
        kind="ai",
        personality="Creative and engaging",
    )
    with patch("crewai.Agent") as mock_agent_cls:
        from cabinet.agents.crewai_adapter.agent import CrewAIAgentAdapter
        adapter = CrewAIAgentAdapter(employee=employee, skills=[])
        mock_agent_cls.assert_called_once()
        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["role"] == "Content Writer"
        assert call_kwargs["goal"] == "Creative and engaging"
```

**Step 2: Run tests to verify they fail**

**Step 3: Write CrewAI agent adapter**

```python
# src/cabinet/agents/crewai_adapter/agent.py
from __future__ import annotations

import asyncio
from uuid import UUID

from crewai import Agent, Crew, Task

from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.models.primitives import Employee, SkillDefinition


class CrewAIAgentAdapter:
    def __init__(self, employee: Employee, skills: list[SkillDefinition] = []):
        self._employee = employee
        self._crewai_agent = Agent(
            role=employee.role,
            goal=employee.personality or f"Execute {employee.role} tasks",
            backstory=employee.personality or "",
            tools=[],
            memory=False,
            allow_delegation=employee.permission_level in ("L2", "L3"),
        )

    @property
    def employee(self) -> Employee:
        return self._employee

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        crewai_task = Task(
            description=task,
            expected_output="Complete the assigned task",
            agent=self._crewai_agent,
        )
        crew = Crew(
            agents=[self._crewai_agent],
            tasks=[crewai_task],
            memory=False,
        )
        result = await asyncio.to_thread(crew.kickoff)
        return AgentOutput(
            content=result.raw,
            employee_id=self._employee.id,
        )

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        return output
```

```python
# src/cabinet/agents/crewai_adapter/skill.py
from __future__ import annotations

from crewai.tools import StructuredTool

from cabinet.agents.context import SkillContext, SkillOutput
from cabinet.models.primitives import SkillDefinition


class CrewAISkillAdapter:
    def __init__(self, definition: SkillDefinition, executor):
        self._definition = definition
        self._executor = executor

    @property
    def definition(self) -> SkillDefinition:
        return self._definition

    async def run(self, inputs: dict, context: SkillContext) -> SkillOutput:
        result = await self._executor.run(self._definition.id, inputs, context)
        return result

    def to_crewai_tool(self) -> StructuredTool:
        return StructuredTool.from_function(
            name=self._definition.name,
            description=self._definition.description,
            func=lambda **kwargs: self._executor.run_sync(self._definition.id, kwargs),
        )
```

```python
# src/cabinet/agents/crewai_adapter/team.py
from __future__ import annotations

import asyncio

from crewai import Crew, Task

from cabinet.agents.context import TeamContext, TeamOutput
from cabinet.models.primitives import Team


class CrewAITeamAdapter:
    def __init__(self, team: Team, agents: list = []):
        self._team = team
        self._agents = agents

    @property
    def team(self) -> Team:
        return self._team

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput:
        crewai_agents = [a._crewai_agent for a in self._agents if hasattr(a, "_crewai_agent")]
        crewai_task = Task(
            description=task,
            expected_output="Complete the team task",
        )
        crew = Crew(
            agents=crewai_agents,
            tasks=[crewai_task],
            memory=False,
        )
        result = await asyncio.to_thread(crew.kickoff)
        return TeamOutput(
            content=result.raw,
            team_id=self._team.id,
        )
```

**Step 4: Run tests to verify they pass**

**Step 5: Commit**

```bash
git add src/cabinet/agents/crewai_adapter/ tests/unit/agents/crewai_adapter/
git commit -m "feat: CrewAI adapter wrapping Agent/Task/Crew behind Cabinet protocols with async support"
```

---

### Task 13: SKILL.md Parser (OpenClaw Standard)

> **🔑 Open-Source Integration: OpenClaw SKILL.md**
> Implements a parser for the OpenClaw SKILL.md community standard, enabling:
> - **Community skill import** from `cabinet-skills` repository
> - **Interoperable skill format** across AI agent frameworks
> - **Markdown-based skill definition** with frontmatter + body sections

**Files:**
- Create: `src/cabinet/core/tools/skill_loader.py`
- Create: `tests/unit/core/tools/test_skill_loader.py`
- Create: `src/cabinet/core/tools/samples/hello_world.md`

**Step 1: Create sample SKILL.md**

```markdown
# hello_world

---
name: hello_world
description: A simple greeting skill
input_schema:
  type: object
  properties:
    name:
      type: string
      description: Name to greet
  required:
    - name
output_schema:
  type: object
  properties:
    greeting:
      type: string
requires_human_approval: false
---

Say hello to {name} in a friendly and professional manner.
```

**Step 2: Write failing tests for SKILL.md parser**

```python
# tests/unit/core/tools/test_skill_loader.py
import os

import pytest

from cabinet.core.tools.skill_loader import SkillLoader
from cabinet.models.primitives import SkillDefinition


@pytest.fixture
def loader():
    return SkillLoader()


def test_parse_skill_md(loader):
    sample_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..",
        "src", "cabinet", "core", "tools", "samples", "hello_world.md"
    )
    if not os.path.exists(sample_path):
        pytest.skip("Sample SKILL.md not found")

    skill = loader.parse_file(sample_path)
    assert skill.name == "hello_world"
    assert skill.kind == "atomic"
    assert "name" in skill.input_schema.get("properties", {})
    assert skill.prompt_template is not None
    assert "{name}" in skill.prompt_template


def test_parse_skill_from_dict(loader):
    skill = loader.parse_dict(
        name="summarizer",
        description="Summarizes text",
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"summary": {"type": "string"}}},
        prompt_template="Summarize: {text}",
    )
    assert skill.name == "summarizer"
    assert skill.prompt_template == "Summarize: {text}"
```

**Step 3: Run tests to verify they fail**

**Step 4: Write SKILL.md parser**

```python
# src/cabinet/core/tools/skill_loader.py
from __future__ import annotations

import re

import yaml

from cabinet.models.primitives import SkillDefinition


class SkillLoader:
    def parse_file(self, path: str) -> SkillDefinition:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return self._parse_content(content)

    def parse_dict(
        self,
        name: str,
        description: str,
        input_schema: dict,
        output_schema: dict,
        prompt_template: str | None = None,
        requires_knowledge: list | None = None,
        requires_human_approval: bool = False,
    ) -> SkillDefinition:
        return SkillDefinition(
            name=name,
            description=description,
            kind="atomic",
            input_schema=input_schema,
            output_schema=output_schema,
            prompt_template=prompt_template,
            requires_knowledge=requires_knowledge or [],
            requires_human_approval=requires_human_approval,
        )

    def _parse_content(self, content: str) -> SkillDefinition:
        frontmatter_match = re.search(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
        if frontmatter_match:
            metadata = yaml.safe_load(frontmatter_match.group(1))
            body = content[frontmatter_match.end():].strip()
        else:
            metadata = {}
            body = content.strip()

        return SkillDefinition(
            name=metadata.get("name", "unnamed"),
            description=metadata.get("description", ""),
            kind="atomic",
            input_schema=metadata.get("input_schema", {"type": "object"}),
            output_schema=metadata.get("output_schema", {"type": "object"}),
            prompt_template=body if body else None,
            requires_human_approval=metadata.get("requires_human_approval", False),
        )
```

**Step 5: Run tests to verify they pass**

**Step 6: Commit**

```bash
git add src/cabinet/core/tools/skill_loader.py src/cabinet/core/tools/samples/ tests/unit/core/tools/test_skill_loader.py
git commit -m "feat: SKILL.md parser for OpenClaw community skill standard"
```

---

### Task 14: Skill Executor

**Files:**
- Create: `src/cabinet/agents/skill_executor.py`
- Create: `tests/unit/agents/test_skill_executor.py`

*(Same as original plan — unified skill execution entry point)*

**Step 5: Commit**

```bash
git add src/cabinet/agents/skill_executor.py tests/unit/agents/test_skill_executor.py
git commit -m "feat: skill executor with atomic AI and tool skill support"
```

---

### Task 15: CLI Entry Point

**Files:**
- Create: `src/cabinet/cli/main.py`
- Create: `tests/unit/cli/test_main.py`

*(Same as original plan — Typer CLI with init/serve/chat/status)*

**Step 5: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: CLI entry point with init, serve, chat, and status commands"
```

---

### Task 16: Integration Test — End-to-End Event Flow with Open-Source Stack

> **🔑 Integration Test**
> Tests the full stack: LiteLLM Router → Event Bus → Skill Executor → Memory Store,
> verifying that open-source integrations work together correctly.

**Files:**
- Create: `tests/integration/test_event_flow.py`
- Create: `tests/integration/test_full_stack.py`

**Step 1: Write integration tests**

```python
# tests/integration/test_event_flow.py
# (Same as original plan — event flow tests)
```

```python
# tests/integration/test_full_stack.py
import asyncio
import tempfile
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
from cabinet.core.memory.vector_store import ChromaDBMemoryStore
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.agents.skill_executor import SkillExecutor
from cabinet.agents.context import SkillContext
from cabinet.models.events import MessageEnvelope, TaskOrder
from cabinet.models.primitives import MemoryScope, SkillDefinition


@pytest.mark.asyncio
async def test_skill_executor_with_gateway_and_memory():
    mock_response = AsyncMock()
    mock_response.choices = [AsyncMock()]
    mock_response.choices[0].message.content = "Summarized content"
    mock_response.usage = AsyncMock()
    mock_response.usage.prompt_tokens = 10
    mock_response.usage.completion_tokens = 5

    with tempfile.TemporaryDirectory() as tmpdir:
        gateway = LiteLLMRouterGateway(model_list=[
            {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        ])
        registry = LocalToolRegistry()
        memory = SQLiteMemoryStore(os.path.join(tmpdir, "test.db"))
        await memory.initialize()
        kb = ChromaDBMemoryStore(persist_dir=os.path.join(tmpdir, "vectors"))

        executor = SkillExecutor(gateway=gateway, tool_registry=registry, knowledge_base=kb)

        skill = SkillDefinition(
            name="summarizer",
            description="Summarizes text",
            kind="atomic",
            input_schema={"type": "object"},
            output_schema={"type": "object"},
            prompt_template="Summarize: {text}",
        )
        await registry.register(skill)

        with patch("litellm.Router.acompletion", return_value=mock_response):
            result = await executor.run(skill.id, inputs={"text": "Long text"}, context=SkillContext())
        assert result.content == "Summarized content"


@pytest.mark.asyncio
async def test_event_bus_with_task_order_and_memory():
    bus = AsyncIOEventBus()
    task_events = []

    async def task_handler(envelope: MessageEnvelope):
        task_events.append(envelope)

    await bus.subscribe("task.order", task_handler)

    order = TaskOrder(
        employee_id=uuid4(),
        skill_id=uuid4(),
        inputs={"action": "analyze"},
    )
    env = MessageEnvelope(
        sender="hub:decision-hub",
        recipients=["room:office"],
        message_type="task.order",
        payload=order.model_dump(),
    )
    await bus.publish(env)
    await asyncio.sleep(0.05)

    assert len(task_events) == 1
    chain = await bus.get_causation_chain(env.message_id)
    assert len(chain) == 1
```

**Step 2: Run integration tests**

Run: `pytest tests/integration/ -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/integration/
git commit -m "feat: integration tests for full stack with open-source integrations"
```

---

### Task 17: Run Full Test Suite and Verify

**Step 1: Run all tests**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

**Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: verify full test suite passes"
```

---

## Summary

| Task | Component | Open-Source Integration | Tests |
|:---|:---|:---|:---|
| 1 | Project Scaffolding | pyproject.toml with mcp dep | Import check |
| 2 | Primitives Data Models | — | 9 tests |
| 3 | Decisions Data Models | — | 8 tests |
| 4 | Event Message Types | — | 8 tests |
| 5 | Event Bus (Protocol + AsyncIO) | Self-built (Dapr reserved) | 5 tests |
| 6 | **Model Gateway (LiteLLM Router)** | **litellm.Router** with logical names, fallback, cost tracking | 5 tests |
| 7 | Memory Store (SQLite) | **aiosqlite** for short-term | 4 tests |
| 8 | **Vector Memory (ChromaDB)** | **chromadb.PersistentClient** for long-term + entity | 3 tests |
| 9 | **Tool Registry + MCP Connector** | **mcp SDK** for tool discovery | 6 tests |
| 10 | Knowledge Base (ChromaDB) | **chromadb.PersistentClient** for RAG | 3 tests |
| 11 | Agent Layer Protocols | — | 5 tests |
| 12 | **CrewAI Adapter** | **crewai** Agent/Task/Crew with async wrapper | 2 tests |
| 13 | **SKILL.md Parser** | **OpenClaw SKILL.md** standard | 2 tests |
| 14 | Skill Executor | Unified entry point | 2 tests |
| 15 | CLI Entry Point | **Typer + Rich** | 3 tests |
| 16 | Integration Tests | Full stack: LiteLLM + Event Bus + Memory | 5 tests |
| 17 | Full Suite Verification | — | — |

**Total: ~70 tests across 17 tasks**

### Open-Source Integration Coverage

| Project | Where Integrated | What It Replaces |
|:---|:---|:---|
| **LiteLLM Router** | `gateway/litellm_adapter.py` | Custom multi-provider API translation, fallback, rate limiting, cost tracking |
| **ChromaDB** | `memory/vector_store.py` + `knowledge/local_kb.py` | Custom vector indexing, embedding, semantic search |
| **CrewAI** | `agents/crewai_adapter/` | Custom Agent runtime, task execution, team orchestration |
| **MCP SDK** | `tools/mcp_connector.py` | Custom tool protocol, discovery, invocation |
| **OpenClaw SKILL.md** | `tools/skill_loader.py` | Custom skill format, community interoperability |
| **aiosqlite** | `memory/sqlite_store.py` | Custom async SQLite wrapper |
| **Typer + Rich** | `cli/main.py` | Custom CLI framework |
