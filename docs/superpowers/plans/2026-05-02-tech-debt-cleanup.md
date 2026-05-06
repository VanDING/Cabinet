# Layer 1+2 Tech Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up all technical debt in Layer 1+2 before entering Layer 3 development — fix bugs, implement skeleton code, add missing models/protocols, and functionalize CLI commands.

**Architecture:** Protocol-first approach continues. Phase 1 fixes blocking bugs (SkillExecutor.run_sync, LocalToolRegistry.execute). Phase 2 replaces MCPConnector skeleton with real MCP SDK stdio transport. Phase 3 adds Workflow node models with Pydantic v2 discriminated unions. Phase 4 defines Harness protocol interfaces (can parallel with Phase 3). Phase 5 functionalizes all CLI commands with real logic. Each phase depends on the previous one (except Phase 4 which can parallel Phase 3).

**Tech Stack:** Python 3.12+, Pydantic v2, LiteLLM (Router mode), MCP Python SDK (stdio transport), Typer + Rich, pytest + pytest-asyncio, ruff

---

## File Structure

### New Files
- `src/cabinet/models/workflows.py` — 8 Workflow node types + discriminated union + Workflow/WorkflowEdge
- `src/cabinet/core/harness/__init__.py` — Harness package init
- `src/cabinet/core/harness/protocol.py` — Evaluator, VerificationGate, EscalationProtocol protocols
- `src/cabinet/core/harness/models.py` — EvaluationResult, GateResult, EscalationVerdict models
- `src/cabinet/cli/config.py` — CabinetConfig model + config read/write helpers
- `tests/unit/models/test_workflows.py` — Workflow model tests
- `tests/unit/core/harness/__init__.py` — Harness test package init
- `tests/unit/core/harness/test_models.py` — Harness model tests
- `tests/unit/core/harness/test_protocols.py` — Harness protocol tests
- `tests/unit/cli/test_config.py` — CabinetConfig tests

### Modified Files
- `src/cabinet/agents/skill_executor.py` — Add `run_sync` method
- `src/cabinet/core/tools/registry.py` — Fix `execute` to delegate to SkillExecutor for prompt_template skills
- `src/cabinet/core/tools/mcp_connector.py` — Rewrite with real MCP SDK stdio transport
- `src/cabinet/cli/main.py` — Add `serve`/`chat` commands, implement real logic for all commands
- `tests/unit/agents/test_skill_executor.py` — Add `run_sync` tests
- `tests/unit/core/tools/test_registry.py` — Add executor delegation tests
- `tests/unit/core/tools/test_mcp_connector.py` — Rewrite with real MCP SDK tests
- `tests/unit/cli/test_main.py` — Update for real command logic

---

### Task 1: SkillExecutor.run_sync (Phase 1.1)

**Files:**
- Modify: `src/cabinet/agents/skill_executor.py`
- Modify: `tests/unit/agents/test_skill_executor.py`

- [ ] **Step 1: Write failing tests for `run_sync`**

Add the following tests to `tests/unit/agents/test_skill_executor.py`:

```python
def test_run_sync_calls_async_run(executor, mock_registry, mock_gateway):
    skill = SkillDefinition(
        name="greet",
        description="Greet someone",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Say hello to {name}",
    )
    mock_registry.get_skill.return_value = skill
    mock_gateway.complete.return_value = MagicMock(content="Hello, Bob!")

    result = executor.run_sync(skill.id, {"name": "Bob"})
    assert result.content == "Hello, Bob!"
    assert result.skill_id == skill.id


def test_run_sync_not_found(executor, mock_registry):
    mock_registry.get_skill.return_value = None
    with pytest.raises(ValueError, match="Skill not found"):
        executor.run_sync(uuid.uuid4(), {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/agents/test_skill_executor.py::test_run_sync_calls_async_run -v`
Expected: FAIL — `AttributeError: 'SkillExecutor' object has no attribute 'run_sync'`

- [ ] **Step 3: Write minimal implementation**

Add `run_sync` method to `src/cabinet/agents/skill_executor.py`. The full file becomes:

```python
from __future__ import annotations

import asyncio
from uuid import UUID

from cabinet.agents.context import SkillContext, SkillOutput
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.core.tools.protocol import ToolRegistry


class SkillExecutor:
    def __init__(self, registry: ToolRegistry, gateway: ModelGateway):
        self._registry = registry
        self._gateway = gateway

    async def run(self, skill_id: UUID, inputs: dict, context: SkillContext) -> SkillOutput:
        skill = await self._registry.get_skill(skill_id)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_id}")

        if skill.prompt_template:
            prompt = skill.prompt_template.format(**inputs)
            response = await self._gateway.complete(
                messages=[{"role": "user", "content": prompt}],
                model=context.model,
                temperature=context.temperature,
            )
            return SkillOutput(content=response.content, skill_id=skill.id)
        else:
            registry_output = await self._registry.execute(skill.name, inputs)
            return SkillOutput(content=registry_output.content, skill_id=skill.id)

    def run_sync(self, skill_id: UUID, inputs: dict) -> SkillOutput:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(
                    asyncio.run,
                    self.run(skill_id, inputs, SkillContext()),
                )
                return future.result()
        return asyncio.run(self.run(skill_id, inputs, SkillContext()))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/agents/test_skill_executor.py -v`
Expected: All 5 tests PASS (3 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/skill_executor.py tests/unit/agents/test_skill_executor.py
git commit -m "fix: add SkillExecutor.run_sync for synchronous skill execution"
```

---

### Task 2: LocalToolRegistry.execute Delegation (Phase 1.2)

**Files:**
- Modify: `src/cabinet/core/tools/registry.py`
- Modify: `tests/unit/core/tools/test_registry.py`

- [ ] **Step 1: Write failing tests for executor delegation**

Add the following tests to `tests/unit/core/tools/test_registry.py`:

```python
@pytest.mark.asyncio
async def test_execute_with_executor_delegates():
    from unittest.mock import AsyncMock

    registry = LocalToolRegistry()
    mock_executor = AsyncMock()
    from cabinet.agents.context import SkillOutput as ExecSkillOutput
    mock_executor.run.return_value = ExecSkillOutput(content="AI result", skill_id=uuid.uuid4())

    skill = SkillDefinition(
        name="ai_skill",
        description="An AI skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Process: {input}",
    )
    await registry.register(skill)
    registry.set_executor(mock_executor)

    output = await registry.execute("ai_skill", {"input": "test"})
    assert output.content == "AI result"
    mock_executor.run.assert_called_once()


@pytest.mark.asyncio
async def test_execute_without_executor_returns_placeholder():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        name="placeholder_skill",
        description="A placeholder skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Process: {input}",
    )
    await registry.register(skill)

    output = await registry.execute("placeholder_skill", {"input": "test"})
    assert output.content == "Executed placeholder_skill"


@pytest.mark.asyncio
async def test_execute_no_prompt_without_executor_returns_placeholder():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        name="tool_skill",
        description="A tool skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)

    output = await registry.execute("tool_skill", {"key": "value"})
    assert output.content == "Executed tool_skill"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/tools/test_registry.py::test_execute_with_executor_delegates -v`
Expected: FAIL — `AttributeError: 'LocalToolRegistry' object has no attribute 'set_executor'`

- [ ] **Step 3: Write minimal implementation**

Replace `src/cabinet/core/tools/registry.py` with:

```python
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from cabinet.core.tools.protocol import SkillOutput
from cabinet.models.primitives import SkillDefinition

if TYPE_CHECKING:
    from cabinet.agents.skill_executor import SkillExecutor


class LocalToolRegistry:
    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}
        self._skills_by_id: dict[UUID, SkillDefinition] = {}
        self._executor: SkillExecutor | None = None

    def set_executor(self, executor: SkillExecutor) -> None:
        self._executor = executor

    async def register(self, skill: SkillDefinition) -> None:
        self._skills[skill.name] = skill
        self._skills_by_id[skill.id] = skill

    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput:
        skill = self._skills.get(skill_name)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_name}")

        if skill.prompt_template and self._executor is not None:
            from cabinet.agents.context import SkillContext

            result = await self._executor.run(skill.id, inputs, SkillContext())
            return SkillOutput(content=result.content, skill_id=skill.id)

        return SkillOutput(content=f"Executed {skill_name}", skill_id=skill.id)

    async def list_skills(self) -> list[SkillDefinition]:
        return list(self._skills.values())

    async def get_skill(self, skill_id: UUID) -> SkillDefinition | None:
        return self._skills_by_id.get(skill_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/tools/test_registry.py -v`
Expected: All 9 tests PASS (6 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/tools/registry.py tests/unit/core/tools/test_registry.py
git commit -m "fix: LocalToolRegistry.execute delegates to SkillExecutor for prompt_template skills"
```

---

### Task 3: MCPConnector Real Implementation (Phase 2)

**Files:**
- Modify: `src/cabinet/core/tools/mcp_connector.py`
- Modify: `tests/unit/core/tools/test_mcp_connector.py`

- [ ] **Step 1: Write failing tests for MCPConnector**

Replace `tests/unit/core/tools/test_mcp_connector.py` with:

```python
from contextlib import AsyncExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cabinet.core.tools.mcp_connector import MCPConnector
from cabinet.models.primitives import SkillDefinition


@pytest.fixture
def connector():
    return MCPConnector()


@pytest.mark.asyncio
async def test_connect_server_establishes_session(connector):
    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()
    mock_tool = MagicMock()
    mock_tool.name = "test_tool"
    mock_tool.description = "A test tool"
    mock_tool.inputSchema = {"type": "object"}
    mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[mock_tool]))

    mock_read = AsyncMock()
    mock_write = AsyncMock()

    with patch("cabinet.core.tools.mcp_connector.stdio_client") as mock_stdio, \
         patch("cabinet.core.tools.mcp_connector.ClientSession", return_value=mock_session), \
         patch("cabinet.core.tools.mcp_connector.AsyncExitStack") as mock_stack_cls:
        mock_stack = AsyncMock()
        mock_stack.enter_async_context = AsyncMock(side_effect=[(mock_read, mock_write), mock_session])
        mock_stack.__aenter__ = AsyncMock(return_value=mock_stack)
        mock_stack.__aexit__ = AsyncMock(return_value=False)
        mock_stack_cls.return_value = mock_stack

        await connector.connect_server("test-server", "python", ["-m", "mcp_server"])

    assert "test-server" in await connector.list_connected_servers()


@pytest.mark.asyncio
async def test_disconnect_server_removes_session(connector):
    connector._sessions["test-server"] = AsyncMock()
    connector._exit_stacks["test-server"] = AsyncMock()
    connector._exit_stacks["test-server"].aclose = AsyncMock()
    connector._tool_to_server["tool_a"] = "test-server"

    await connector.disconnect_server("test-server")

    assert "test-server" not in connector._sessions
    assert "test-server" not in connector._exit_stacks
    assert "tool_a" not in connector._tool_to_server


@pytest.mark.asyncio
async def test_disconnect_all_removes_all_sessions(connector):
    connector._sessions["s1"] = AsyncMock()
    connector._sessions["s2"] = AsyncMock()
    connector._exit_stacks["s1"] = AsyncMock()
    connector._exit_stacks["s1"].aclose = AsyncMock()
    connector._exit_stacks["s2"] = AsyncMock()
    connector._exit_stacks["s2"].aclose = AsyncMock()

    await connector.disconnect_all()

    assert len(connector._sessions) == 0
    assert len(connector._exit_stacks) == 0


@pytest.mark.asyncio
async def test_discover_tools_maps_to_skill_definitions(connector):
    mock_tool = MagicMock()
    mock_tool.name = "send_email"
    mock_tool.description = "Send an email"
    mock_tool.inputSchema = {"type": "object", "properties": {"to": {"type": "string"}}}

    mock_session = AsyncMock()
    mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[mock_tool]))
    connector._sessions["email-server"] = mock_session
    connector._tool_to_server["send_email"] = "email-server"

    skills = await connector.discover_tools("email-server")
    assert len(skills) == 1
    assert isinstance(skills[0], SkillDefinition)
    assert skills[0].name == "send_email"
    assert skills[0].kind == "atomic"
    assert skills[0].input_schema == {"type": "object", "properties": {"to": {"type": "string"}}}


@pytest.mark.asyncio
async def test_call_tool_routes_to_correct_server(connector):
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.content = [MagicMock(text="Email sent")]
    mock_session.call_tool = AsyncMock(return_value=mock_result)
    connector._sessions["email-server"] = mock_session
    connector._tool_to_server["send_email"] = "email-server"

    result = await connector.call_tool("send_email", {"to": "test@example.com"})
    assert result["content"] == "Email sent"
    mock_session.call_tool.assert_called_once_with("send_email", {"to": "test@example.com"})


@pytest.mark.asyncio
async def test_call_tool_unknown_tool_raises(connector):
    with pytest.raises(ValueError, match="Unknown tool"):
        await connector.call_tool("unknown_tool", {})


@pytest.mark.asyncio
async def test_list_connected_servers(connector):
    connector._sessions["s1"] = AsyncMock()
    connector._sessions["s2"] = AsyncMock()

    servers = await connector.list_connected_servers()
    assert sorted(servers) == ["s1", "s2"]


@pytest.mark.asyncio
async def test_connect_server_already_connected_raises(connector):
    connector._sessions["existing"] = AsyncMock()
    with pytest.raises(ValueError, match="already connected"):
        await connector.connect_server("existing", "python", [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/tools/test_mcp_connector.py -v`
Expected: FAIL — multiple import and attribute errors

- [ ] **Step 3: Write implementation**

Replace `src/cabinet/core/tools/mcp_connector.py` with:

```python
from __future__ import annotations

from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from cabinet.models.primitives import SkillDefinition


class MCPConnector:
    def __init__(self):
        self._sessions: dict[str, ClientSession] = {}
        self._exit_stacks: dict[str, AsyncExitStack] = {}
        self._tool_to_server: dict[str, str] = {}

    async def connect_server(
        self,
        name: str,
        command: str,
        args: list[str] = [],
        env: dict[str, str] | None = None,
    ) -> None:
        if name in self._sessions:
            raise ValueError(f"Server '{name}' already connected")

        stack = AsyncExitStack()
        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=env,
        )
        read_stream, write_stream = await stack.enter_async_context(
            stdio_client(server_params)
        )
        session = await stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await session.initialize()

        self._sessions[name] = session
        self._exit_stacks[name] = stack

        result = await session.list_tools()
        for tool in result.tools:
            self._tool_to_server[tool.name] = name

    async def disconnect_server(self, name: str) -> None:
        stack = self._exit_stacks.pop(name, None)
        if stack is not None:
            await stack.aclose()
        self._sessions.pop(name, None)
        self._tool_to_server = {
            k: v for k, v in self._tool_to_server.items() if v != name
        }

    async def disconnect_all(self) -> None:
        for name in list(self._sessions.keys()):
            await self.disconnect_server(name)

    async def discover_tools(self, server_name: str) -> list[SkillDefinition]:
        session = self._sessions.get(server_name)
        if session is None:
            raise ValueError(f"Server '{server_name}' not connected")

        result = await session.list_tools()
        return [
            SkillDefinition(
                name=tool.name,
                description=tool.description or "",
                kind="atomic",
                input_schema=tool.inputSchema if hasattr(tool, "inputSchema") and tool.inputSchema else {"type": "object"},
                output_schema={"type": "object"},
            )
            for tool in result.tools
        ]

    async def call_tool(self, tool_name: str, arguments: dict) -> dict[str, Any]:
        server_name = self._tool_to_server.get(tool_name)
        if server_name is None:
            raise ValueError(f"Unknown tool: {tool_name}")

        session = self._sessions.get(server_name)
        if session is None:
            raise ValueError(f"Server '{server_name}' not connected")

        result = await session.call_tool(tool_name, arguments)
        content_parts = []
        for item in result.content:
            if hasattr(item, "text"):
                content_parts.append(item.text)
        return {"content": " ".join(content_parts) if content_parts else str(result.content)}

    async def list_connected_servers(self) -> list[str]:
        return list(self._sessions.keys())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/tools/test_mcp_connector.py -v`
Expected: All 8 tests PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/tools/mcp_connector.py tests/unit/core/tools/test_mcp_connector.py
git commit -m "feat: MCPConnector with real MCP SDK stdio transport, session lifecycle, and tool discovery"
```

---

### Task 4: Workflow Node Models (Phase 3)

**Files:**
- Create: `src/cabinet/models/workflows.py`
- Create: `tests/unit/models/test_workflows.py`

- [ ] **Step 1: Write failing tests for Workflow models**

Create `tests/unit/models/test_workflows.py`:

```python
import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    HumanApprovalNode,
    HumanNode,
    LoopNode,
    ParallelNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowEdge,
    WorkflowNode,
)


def test_trigger_node():
    node = TriggerNode(
        trigger_type="manual",
        condition="user_starts_workflow",
    )
    assert node.kind == "trigger"
    assert node.trigger_type == "manual"


def test_skill_node():
    skill_id = uuid.uuid4()
    employee_id = uuid.uuid4()
    node = SkillNode(
        skill_id=skill_id,
        employee_id=employee_id,
        inputs={"text": "input"},
    )
    assert node.kind == "skill"
    assert node.skill_id == skill_id


def test_condition_node():
    true_id = uuid.uuid4()
    false_id = uuid.uuid4()
    node = ConditionNode(
        expression="score > 0.8",
        true_next=true_id,
        false_next=false_id,
    )
    assert node.kind == "condition"
    assert node.true_next == true_id


def test_loop_node():
    body_id = uuid.uuid4()
    node = LoopNode(
        iterator_expr="items",
        body_node_ids=[body_id],
    )
    assert node.kind == "loop"
    assert len(node.body_node_ids) == 1


def test_human_approval_node():
    node = HumanApprovalNode(
        decision_type="execution",
        message_template="Approve sending email to {recipient}?",
    )
    assert node.kind == "human_approval"
    assert node.decision_type == "execution"


def test_human_node():
    emp_id = uuid.uuid4()
    node = HumanNode(
        employee_id=emp_id,
        input_protocol={"task_template": "Review {document}"},
        output_protocol={"format": "text"},
        timeout=3600,
        timeout_strategy="escalate",
    )
    assert node.kind == "human"
    assert node.timeout == 3600


def test_parallel_node():
    branch_a = uuid.uuid4()
    branch_b = uuid.uuid4()
    node = ParallelNode(
        branch_node_ids=[branch_a, branch_b],
        aggregation_strategy="wait_all",
    )
    assert node.kind == "parallel"
    assert len(node.branch_node_ids) == 2


def test_end_node():
    node = EndNode(
        output_mapping={"result": "$.output"},
    )
    assert node.kind == "end"


def test_workflow_edge():
    source = uuid.uuid4()
    target = uuid.uuid4()
    edge = WorkflowEdge(
        source_node_id=source,
        target_node_id=target,
    )
    assert edge.source_node_id == source
    assert edge.condition is None


def test_workflow_edge_with_condition():
    source = uuid.uuid4()
    target = uuid.uuid4()
    edge = WorkflowEdge(
        source_node_id=source,
        target_node_id=target,
        condition="approved == true",
    )
    assert edge.condition == "approved == true"


def test_workflow_creation():
    proj_id = uuid.uuid4()
    trigger = TriggerNode(trigger_type="manual", condition="start")
    skill = SkillNode(
        skill_id=uuid.uuid4(),
        employee_id=uuid.uuid4(),
    )
    end = EndNode(output_mapping={})

    wf = Workflow(
        project_id=proj_id,
        name="Test Workflow",
        kind="team",
        nodes=[trigger, skill, end],
        edges=[
            WorkflowEdge(source_node_id=trigger.id, target_node_id=skill.id),
            WorkflowEdge(source_node_id=skill.id, target_node_id=end.id),
        ],
    )
    assert wf.name == "Test Workflow"
    assert wf.kind == "team"
    assert len(wf.nodes) == 3
    assert len(wf.edges) == 2
    assert wf.version == 1


def test_workflow_discriminated_union_deserialization():
    proj_id = uuid.uuid4()
    trigger = TriggerNode(trigger_type="webhook", condition="payload.action == 'create'")

    node_data = {"kind": "trigger", "trigger_type": "manual", "condition": "start"}
    node = WorkflowNode.model_validate(node_data)
    assert isinstance(node, TriggerNode)
    assert node.trigger_type == "manual"


def test_workflow_composite_skill_kind():
    proj_id = uuid.uuid4()
    wf = Workflow(
        project_id=proj_id,
        name="Composite Skill",
        kind="composite_skill",
        nodes=[TriggerNode(trigger_type="manual", condition="start")],
        edges=[],
    )
    assert wf.kind == "composite_skill"


def test_workflow_invalid_kind():
    proj_id = uuid.uuid4()
    with pytest.raises(ValidationError):
        Workflow(
            project_id=proj_id,
            name="Bad",
            kind="invalid",
            nodes=[],
            edges=[],
        )


def test_all_node_types_have_id():
    nodes = [
        TriggerNode(trigger_type="manual", condition="start"),
        SkillNode(skill_id=uuid.uuid4(), employee_id=uuid.uuid4()),
        ConditionNode(expression="x > 0", true_next=uuid.uuid4(), false_next=uuid.uuid4()),
        LoopNode(iterator_expr="items", body_node_ids=[uuid.uuid4()]),
        HumanApprovalNode(decision_type="execution", message_template="Approve?"),
        HumanNode(employee_id=uuid.uuid4()),
        ParallelNode(branch_node_ids=[uuid.uuid4()], aggregation_strategy="wait_all"),
        EndNode(output_mapping={}),
    ]
    for node in nodes:
        assert node.id is not None
        assert node.name is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/models/test_workflows.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.models.workflows'`

- [ ] **Step 3: Write implementation**

Create `src/cabinet/models/workflows.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class TriggerNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["trigger"] = "trigger"
    name: str = "trigger"
    trigger_type: str
    condition: str | None = None


class SkillNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["skill"] = "skill"
    name: str = "skill"
    skill_id: UUID
    employee_id: UUID
    inputs: dict = {}


class ConditionNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["condition"] = "condition"
    name: str = "condition"
    expression: str
    true_next: UUID
    false_next: UUID


class LoopNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["loop"] = "loop"
    name: str = "loop"
    iterator_expr: str
    body_node_ids: list[UUID]


class HumanApprovalNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["human_approval"] = "human_approval"
    name: str = "human_approval"
    decision_type: str
    message_template: str | None = None


class HumanNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["human"] = "human"
    name: str = "human"
    employee_id: UUID
    input_protocol: dict | None = None
    output_protocol: dict | None = None
    timeout: int | None = None
    timeout_strategy: str = "escalate"


class ParallelNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["parallel"] = "parallel"
    name: str = "parallel"
    branch_node_ids: list[UUID]
    aggregation_strategy: str = "wait_all"


class EndNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["end"] = "end"
    name: str = "end"
    output_mapping: dict = {}


WorkflowNode = Annotated[
    Union[
        TriggerNode,
        SkillNode,
        ConditionNode,
        LoopNode,
        HumanApprovalNode,
        HumanNode,
        ParallelNode,
        EndNode,
    ],
    Field(discriminator="kind"),
]


class WorkflowEdge(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    source_node_id: UUID
    target_node_id: UUID
    condition: str | None = None


class Workflow(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    name: str
    kind: Literal["team", "composite_skill"]
    nodes: list[Annotated[WorkflowNode, Field(discriminator="kind")]]
    edges: list[WorkflowEdge]
    version: int = 1
    created_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/models/test_workflows.py -v`
Expected: All 15 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/models/workflows.py tests/unit/models/test_workflows.py
git commit -m "feat: Workflow node models with 8 types and Pydantic v2 discriminated union"
```

---

### Task 5: Harness Data Models (Phase 4, part 1)

**Files:**
- Create: `src/cabinet/core/harness/__init__.py`
- Create: `src/cabinet/core/harness/models.py`
- Create: `tests/unit/core/harness/__init__.py`
- Create: `tests/unit/core/harness/test_models.py`

- [ ] **Step 1: Write failing tests for Harness models**

Create `tests/unit/core/harness/__init__.py` (empty file).

Create `tests/unit/core/harness/test_models.py`:

```python
from cabinet.core.harness.models import EvaluationResult, EscalationVerdict, GateResult


def test_evaluation_result_passed():
    result = EvaluationResult(passed=True, score=0.95)
    assert result.passed is True
    assert result.score == 0.95
    assert result.issues == []
    assert result.suggestions == []


def test_evaluation_result_failed_with_issues():
    result = EvaluationResult(
        passed=False,
        score=0.3,
        issues=["Missing required field", "Invalid format"],
        suggestions=["Add the 'name' field", "Use ISO 8601 date format"],
    )
    assert result.passed is False
    assert len(result.issues) == 2
    assert len(result.suggestions) == 2


def test_gate_result_passed():
    result = GateResult(passed=True)
    assert result.passed is True
    assert result.reason is None
    assert result.retry_allowed is True


def test_gate_result_failed_with_reason():
    result = GateResult(
        passed=False,
        reason="Output quality below threshold",
        retry_allowed=False,
    )
    assert result.passed is False
    assert result.reason == "Output quality below threshold"
    assert result.retry_allowed is False


def test_escalation_verdict_escalate():
    verdict = EscalationVerdict(
        escalate=True,
        reason="High-risk operation detected",
    )
    assert verdict.escalate is True
    assert verdict.auto_action is None


def test_escalation_verdict_no_escalate_with_auto_action():
    verdict = EscalationVerdict(
        escalate=False,
        reason="Known anomaly pattern, auto-retry",
        auto_action="retry_with_backoff",
    )
    assert verdict.escalate is False
    assert verdict.auto_action == "retry_with_backoff"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/harness/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.harness'`

- [ ] **Step 3: Write implementation**

Create `src/cabinet/core/harness/__init__.py` (empty file).

Create `src/cabinet/core/harness/models.py`:

```python
from __future__ import annotations

from pydantic import BaseModel


class EvaluationResult(BaseModel):
    passed: bool
    score: float
    issues: list[str] = []
    suggestions: list[str] = []


class GateResult(BaseModel):
    passed: bool
    reason: str | None = None
    retry_allowed: bool = True


class EscalationVerdict(BaseModel):
    escalate: bool
    reason: str
    auto_action: str | None = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/harness/test_models.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/harness/ tests/unit/core/harness/
git commit -m "feat: Harness data models — EvaluationResult, GateResult, EscalationVerdict"
```

---

### Task 6: Harness Protocol Interfaces (Phase 4, part 2)

**Files:**
- Create: `src/cabinet/core/harness/protocol.py`
- Create: `tests/unit/core/harness/test_protocols.py`

- [ ] **Step 1: Write failing tests for Harness protocols**

Create `tests/unit/core/harness/test_protocols.py`:

```python
from unittest.mock import AsyncMock

import pytest

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import EscalationVerdict, EvaluationResult, GateResult
from cabinet.core.harness.protocol import EscalationProtocol, Evaluator, VerificationGate
from cabinet.models.decisions import Decision, DecisionType
from uuid import uuid4


def test_evaluator_protocol_runtime_checkable():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(passed=True, score=1.0)

    mock = MockEvaluator()
    assert isinstance(mock, Evaluator)


def test_verification_gate_protocol_runtime_checkable():
    class MockGate:
        async def check(self, node_id, context):
            return GateResult(passed=True)

    mock = MockGate()
    assert isinstance(mock, VerificationGate)


def test_escalation_protocol_runtime_checkable():
    class MockEscalation:
        async def should_escalate(self, decision):
            return EscalationVerdict(escalate=False, reason="ok")

        async def auto_handle(self, decision):
            return decision

    mock = MockEscalation()
    assert isinstance(mock, EscalationProtocol)


@pytest.mark.asyncio
async def test_evaluator_evaluate_contract():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(
                passed=True,
                score=0.9,
                issues=[],
                suggestions=["Consider adding more detail"],
            )

    evaluator = MockEvaluator()
    output = AgentOutput(content="Test output", employee_id=uuid4())
    result = await evaluator.evaluate(output, ["accuracy", "completeness"])
    assert isinstance(result, EvaluationResult)
    assert result.passed is True


@pytest.mark.asyncio
async def test_verification_gate_check_contract():
    class MockGate:
        async def check(self, node_id, context):
            return GateResult(passed=False, reason="Quality below threshold", retry_allowed=True)

    gate = MockGate()
    result = await gate.check(uuid4(), {"output": "test"})
    assert isinstance(result, GateResult)
    assert result.passed is False


@pytest.mark.asyncio
async def test_escalation_protocol_should_escalate_contract():
    class MockEscalation:
        async def should_escalate(self, decision):
            return EscalationVerdict(escalate=True, reason="High risk")

        async def auto_handle(self, decision):
            return decision

    protocol = MockEscalation()
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="API timeout",
        description="External API timed out 3 times",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert isinstance(verdict, EscalationVerdict)
    assert verdict.escalate is True


@pytest.mark.asyncio
async def test_escalation_protocol_auto_handle_contract():
    class MockEscalation:
        async def should_escalate(self, decision):
            return EscalationVerdict(escalate=False, reason="ok")

        async def auto_handle(self, decision):
            return decision

    protocol = MockEscalation()
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Auto-approve",
        description="Routine task",
        captain_id="captain-1",
    )
    result = await protocol.auto_handle(decision)
    assert result.id == decision.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/harness/test_protocols.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.harness.protocol'`

- [ ] **Step 3: Write implementation**

Create `src/cabinet/core/harness/protocol.py`:

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import EscalationVerdict, EvaluationResult, GateResult
from cabinet.models.decisions import Decision


@runtime_checkable
class Evaluator(Protocol):
    async def evaluate(self, output: AgentOutput, criteria: list[str]) -> EvaluationResult: ...


@runtime_checkable
class VerificationGate(Protocol):
    async def check(self, node_id: UUID, context: dict) -> GateResult: ...


@runtime_checkable
class EscalationProtocol(Protocol):
    async def should_escalate(self, decision: Decision) -> EscalationVerdict: ...
    async def auto_handle(self, decision: Decision) -> Decision: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/harness/test_protocols.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/harness/protocol.py tests/unit/core/harness/test_protocols.py
git commit -m "feat: Harness protocol interfaces — Evaluator, VerificationGate, EscalationProtocol"
```

---

### Task 7: CabinetConfig + `cabinet init` Command (Phase 5, part 1)

**Files:**
- Create: `src/cabinet/cli/config.py`
- Create: `tests/unit/cli/test_config.py`
- Modify: `src/cabinet/cli/main.py`
- Modify: `tests/unit/cli/test_main.py`

- [ ] **Step 1: Write failing tests for CabinetConfig**

Create `tests/unit/cli/test_config.py`:

```python
import json
import os
import tempfile

import pytest

from cabinet.cli.config import CabinetConfig, load_config, save_config
from cabinet.models.primitives import Organization


def test_cabinet_config_creation():
    org = Organization(name="TestOrg", captain_id="captain-1")
    config = CabinetConfig(organization=org, default_project=org.projects[0] if org.projects else __import__("uuid").uuid4())
    assert config.organization.name == "TestOrg"
    assert config.model_config_path == "data/models.json"


def test_save_and_load_config():
    org = Organization(name="TestOrg", captain_id="captain-1")
    proj_id = __import__("uuid").uuid4()
    config = CabinetConfig(organization=org, default_project=proj_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "cabinet.json")
        save_config(config, path)
        assert os.path.exists(path)

        loaded = load_config(path)
        assert loaded.organization.name == "TestOrg"
        assert loaded.default_project == proj_id


def test_save_config_creates_valid_json():
    org = Organization(name="TestOrg", captain_id="captain-1")
    proj_id = __import__("uuid").uuid4()
    config = CabinetConfig(organization=org, default_project=proj_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "cabinet.json")
        save_config(config, path)

        with open(path) as f:
            data = json.load(f)
        assert data["organization"]["name"] == "TestOrg"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/cli/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.cli.config'`

- [ ] **Step 3: Write CabinetConfig implementation**

Create `src/cabinet/cli/config.py`:

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.models.primitives import Organization


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    created_at: datetime = Field(default_factory=_now)


def save_config(config: CabinetConfig, path: str = "data/cabinet.json") -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(config.model_dump_json(indent=2))


def load_config(path: str = "data/cabinet.json") -> CabinetConfig:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return CabinetConfig.model_validate(data)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/cli/test_config.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Write failing tests for `cabinet init` command**

Replace `tests/unit/cli/test_main.py` with:

```python
import os
import tempfile

from typer.testing import CliRunner

from cabinet.cli.main import app

runner = CliRunner()


def test_version():
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert "Cabinet" in result.output


def test_init_creates_structure():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "TestOrg" in result.output
        assert os.path.exists(os.path.join(tmpdir, "cabinet.json"))
        assert os.path.isdir(os.path.join(tmpdir, "db"))
        assert os.path.isdir(os.path.join(tmpdir, "vectors"))
        assert os.path.isdir(os.path.join(tmpdir, "knowledge"))


def test_init_prevents_duplicate():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code != 0
        assert "already initialized" in result.output.lower()


def test_status_without_init():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["status", "--data-dir", tmpdir])
        assert result.exit_code != 0


def test_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "init" in result.output
    assert "status" in result.output
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pytest tests/unit/cli/test_main.py::test_init_creates_structure -v`
Expected: FAIL — `No such option: --data-dir`

- [ ] **Step 7: Implement `cabinet init` command**

Replace `src/cabinet/cli/main.py` with:

```python
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel

from cabinet import __version__

app = typer.Typer(name="cabinet", help="Cabinet — AI Collaboration Framework")
console = Console()


@app.command()
def version():
    console.print(f"Cabinet v{__version__}")


@app.command()
def init(
    name: str = typer.Argument(..., help="Organization name"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if os.path.exists(config_path):
        console.print(f"[red]Error:[/red] Cabinet already initialized at {data_dir}")
        raise typer.Exit(code=1)

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    org = Organization(name=name, captain_id="captain")
    project = Project(
        organization_id=org.id,
        name=f"{name} Default Project",
        description="Default project for the organization",
    )
    org.projects.append(project.id)

    config = CabinetConfig(organization=org, default_project=project.id)

    Path(data_dir).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "db")).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "vectors")).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "knowledge")).mkdir(parents=True, exist_ok=True)

    save_config(config, config_path)

    asyncio.run(_init_db(os.path.join(data_dir, "db", "cabinet.db")))

    console.print(Panel(
        f"[bold green]Cabinet initialized![/bold green]\n\n"
        f"Organization: {name}\n"
        f"Captain ID: captain\n"
        f"Data directory: {data_dir}",
        title="Cabinet Init",
    ))


@app.command()
def status(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print(f"[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.cli.config import load_config
    from rich.table import Table

    config = load_config(config_path)

    table = Table(title="Cabinet Status")
    table.add_column("Property", style="cyan")
    table.add_column("Value", style="green")
    table.add_row("Organization", config.organization.name)
    table.add_row("Captain ID", config.organization.captain_id)
    table.add_row("Created", str(config.created_at.strftime("%Y-%m-%d %H:%M:%S")))
    table.add_row("Data Directory", data_dir)

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if os.path.exists(db_path):
        db_size = os.path.getsize(db_path)
        table.add_row("DB Size", f"{db_size} bytes")
    else:
        table.add_row("DB Size", "Not created")

    console.print(table)


@app.command()
def serve(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print(f"[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_serve_async(data_dir))


@app.command()
def chat(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print(f"[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_chat_async(data_dir))


async def _init_db(db_path: str) -> None:
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore

    store = SQLiteMemoryStore(db_path=db_path)
    await store.initialize()
    await store.close()


async def _serve_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.core.events.asyncio_bus import AsyncIOEventBus
    from cabinet.core.events.store import EventStore
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    bus = AsyncIOEventBus()
    store = EventStore()
    gateway = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST)

    console.print(Panel(
        f"[bold green]Cabinet is serving[/bold green]\n\n"
        f"Organization: {config.organization.name}\n"
        f"Event Bus: active\n"
        f"Gateway: {len(gateway.list_models())} model(s) available\n\n"
        f"Press Ctrl+C to stop",
        title="Cabinet Serve",
    ))

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass


async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from rich.markdown import Markdown
    from rich.prompt import Prompt

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    gateway = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST)

    console.print(Panel(
        f"[bold]Cabinet Chat[/bold]\n"
        f"Organization: {config.organization.name}\n\n"
        f"Type [cyan]/quit[/cyan] to exit, [cyan]/status[/cyan] for status",
        title="Cabinet Chat",
    ))

    messages: list[dict] = []
    while True:
        try:
            user_input = Prompt.ask("[bold cyan]You[/bold cyan]")
        except (EOFError, KeyboardInterrupt):
            break

        if user_input.strip() == "/quit":
            break
        if user_input.strip() == "/status":
            console.print(f"Messages in context: {len(messages)}")
            continue
        if not user_input.strip():
            continue

        messages.append({"role": "user", "content": user_input})
        try:
            response = await gateway.complete(messages=messages, model="default")
            messages.append({"role": "assistant", "content": response.content})
            console.print(Markdown(response.content))
            console.print()
        except Exception as e:
            console.print(f"[red]Error:[/red] {e}")
            messages.pop()


if __name__ == "__main__":
    app()
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest tests/unit/cli/ -v`
Expected: All tests PASS

- [ ] **Step 9: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/cabinet/cli/ tests/unit/cli/
git commit -m "feat: CabinetConfig model, functional init/serve/status/chat CLI commands"
```

---

### Task 8: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Verify all existing tests still pass**

Run: `pytest tests/ -v --tb=short -q`
Expected: Same test count or higher than before (78+ tests)

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: verify full test suite passes after tech debt cleanup"
```

---

## Summary

| Task | Phase | Component | New Tests | Key Changes |
|:---|:---|:---|:---|:---|
| 1 | Bug Fix | SkillExecutor.run_sync | 2 | Add sync wrapper for async `run` |
| 2 | Bug Fix | LocalToolRegistry.execute | 3 | Delegate to executor for prompt_template skills |
| 3 | MCP | MCPConnector real impl | 8 | MCP SDK stdio transport, session lifecycle |
| 4 | Workflow | Node models + discriminated union | 15 | 8 node types, Workflow, WorkflowEdge |
| 5 | Harness | Data models | 6 | EvaluationResult, GateResult, EscalationVerdict |
| 6 | Harness | Protocol interfaces | 6 | Evaluator, VerificationGate, EscalationProtocol |
| 7 | CLI | Config + all commands | 8 | CabinetConfig, init/serve/status/chat |
| 8 | Verify | Full suite + lint | 0 | Verification only |

**Total: ~48 new tests across 8 tasks (78 existing → 126+ total)**

## Execution Order

```
Task 1: SkillExecutor.run_sync        (Phase 1.1)
Task 2: LocalToolRegistry.execute     (Phase 1.2)
         ↓
Task 3: MCPConnector                  (Phase 2)
         ↓
Task 4: Workflow Node Models          (Phase 3)
         ↓
Task 5: Harness Data Models           (Phase 4, can parallel with Task 4)
Task 6: Harness Protocols             (Phase 4, depends on Task 5)
         ↓
Task 7: CLI Commands                  (Phase 5, depends on Tasks 1-6)
         ↓
Task 8: Full Verification
```
