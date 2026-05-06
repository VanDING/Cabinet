# MVP CLI 补全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 MVP CLI 未达标项（employee add, skill run）+ KnowledgeBase 注入 + 跨室工作流 CLI 入口 + Chat 流式输出

**Architecture:** 分层扩展 — 先建数据持久化层（EmployeeStore, SkillStore, KnowledgeBase 注入），再加 CLI 命令层（employee/skill/knowledge 命令），最后增强 Chat 交互层（斜杠命令 + 流式输出）

**Tech Stack:** Python 3.12, Pydantic, Typer, Rich, ChromaDB, pytest + pytest-asyncio

---

### Task 1: JsonEmployeeStore — 员工注册表

**Files:**
- Create: `src/cabinet/agents/employee_store.py`
- Test: `tests/unit/agents/test_employee_store.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agents/test_employee_store.py`:

```python
import json
import os
from uuid import UUID, uuid4

import pytest

from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.models.primitives import Employee


@pytest.fixture
def store(tmp_path):
    path = str(tmp_path / "employees.json")
    return JsonEmployeeStore(path=path)


@pytest.mark.asyncio
async def test_initialize_creates_file_if_not_exists(store, tmp_path):
    await store.initialize()
    assert os.path.exists(str(tmp_path / "employees.json"))


@pytest.mark.asyncio
async def test_add_and_get(store):
    await store.initialize()
    employee = Employee(
        id=uuid4(),
        team_id=uuid4(),
        name="策略顾问",
        role="advisor",
        kind="ai",
        personality="提供多角度分析",
    )
    await store.add(employee)
    found = await store.get(employee.id)
    assert found is not None
    assert found.name == "策略顾问"
    assert found.role == "advisor"


@pytest.mark.asyncio
async def test_get_not_found(store):
    await store.initialize()
    result = await store.get(uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_list_all_empty(store):
    await store.initialize()
    employees = await store.list_all()
    assert employees == []


@pytest.mark.asyncio
async def test_list_all_returns_added_employees(store):
    await store.initialize()
    e1 = Employee(id=uuid4(), team_id=uuid4(), name="A", role="advisor", kind="ai")
    e2 = Employee(id=uuid4(), team_id=uuid4(), name="B", role="executor", kind="ai")
    await store.add(e1)
    await store.add(e2)
    employees = await store.list_all()
    assert len(employees) == 2


@pytest.mark.asyncio
async def test_mount_skill(store):
    await store.initialize()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="A", role="advisor", kind="ai")
    await store.add(employee)
    skill_id = uuid4()
    await store.mount_skill(employee.id, skill_id)
    found = await store.get(employee.id)
    assert skill_id in found.skills


@pytest.mark.asyncio
async def test_persistence_roundtrip(tmp_path):
    path = str(tmp_path / "employees.json")
    store1 = JsonEmployeeStore(path=path)
    await store1.initialize()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="A", role="advisor", kind="ai")
    await store1.add(employee)
    await store1.save()

    store2 = JsonEmployeeStore(path=path)
    await store2.initialize()
    found = await store2.get(employee.id)
    assert found is not None
    assert found.name == "A"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_employee_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.agents.employee_store'`

- [ ] **Step 3: Write minimal implementation**

Create `src/cabinet/agents/employee_store.py`:

```python
from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from cabinet.models.primitives import Employee


class JsonEmployeeStore:
    def __init__(self, path: str = "data/employees.json"):
        self._path = path
        self._employees: dict[UUID, Employee] = {}

    async def initialize(self) -> None:
        p = Path(self._path)
        if p.exists():
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                emp = Employee.model_validate(item)
                self._employees[emp.id] = emp
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump([], f)

    async def add(self, employee: Employee) -> None:
        self._employees[employee.id] = employee
        await self.save()

    async def get(self, employee_id: UUID) -> Employee | None:
        return self._employees.get(employee_id)

    async def list_all(self) -> list[Employee]:
        return list(self._employees.values())

    async def mount_skill(self, employee_id: UUID, skill_id: UUID) -> None:
        emp = self._employees.get(employee_id)
        if emp is None:
            raise KeyError(f"Employee {employee_id} not found")
        self._employees[employee_id] = emp.model_copy(
            update={"skills": [*emp.skills, skill_id]}
        )
        await self.save()

    async def save(self) -> None:
        data = [emp.model_dump(mode="json") for emp in self._employees.values()]
        Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_employee_store.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/employee_store.py tests/unit/agents/test_employee_store.py
git commit -m "feat: add JsonEmployeeStore for persistent employee registry"
```

---

### Task 2: SkillStore — 技能注册表

**Files:**
- Create: `src/cabinet/core/tools/skill_store.py`
- Test: `tests/unit/core/tools/test_skill_store.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/tools/test_skill_store.py`:

```python
import os
from pathlib import Path

import pytest

from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.tools.skill_store import SkillStore
from cabinet.models.primitives import SkillDefinition


@pytest.fixture
def skills_dir(tmp_path):
    d = tmp_path / "skills"
    d.mkdir()
    return str(d)


@pytest.fixture
def registry():
    return LocalToolRegistry()


@pytest.fixture
def store(skills_dir):
    return SkillStore(skills_dir=skills_dir)


@pytest.mark.asyncio
async def test_initialize_empty_dir(store, registry):
    await store.initialize(registry)
    skills = await registry.list_skills()
    assert skills == []


@pytest.mark.asyncio
async def test_initialize_loads_md_files(store, registry, skills_dir):
    skill_content = """---
name: test_skill
description: A test skill
input_schema:
  type: object
output_schema:
  type: object
---

Process the following: {input}
"""
    with open(os.path.join(skills_dir, "test_skill.md"), "w") as f:
        f.write(skill_content)
    await store.initialize(registry)
    skills = await registry.list_skills()
    assert len(skills) == 1
    assert skills[0].name == "test_skill"


@pytest.mark.asyncio
async def test_load_skill_from_path(store, registry, skills_dir, tmp_path):
    skill_file = tmp_path / "external.md"
    skill_file.write_text("""---
name: external_skill
description: External
input_schema:
  type: object
output_schema:
  type: object
---

Do something
""")
    skill = await store.load_skill(str(skill_file), registry)
    assert skill.name == "external_skill"
    skills = await registry.list_skills()
    assert len(skills) == 1
    assert os.path.exists(os.path.join(skills_dir, "external.md"))


@pytest.mark.asyncio
async def test_initialize_skips_non_md_files(store, registry, skills_dir):
    with open(os.path.join(skills_dir, "readme.txt"), "w") as f:
        f.write("not a skill")
    await store.initialize(registry)
    skills = await registry.list_skills()
    assert skills == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/tools/test_skill_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.core.tools.skill_store'`

- [ ] **Step 3: Write minimal implementation**

Create `src/cabinet/core/tools/skill_store.py`:

```python
from __future__ import annotations

import shutil
from pathlib import Path

from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.tools.skill_loader import SkillLoader
from cabinet.models.primitives import SkillDefinition


class SkillStore:
    def __init__(self, skills_dir: str = "data/skills"):
        self._skills_dir = skills_dir
        self._loader = SkillLoader()

    async def initialize(self, registry: LocalToolRegistry) -> None:
        skills_path = Path(self._skills_dir)
        if not skills_path.exists():
            skills_path.mkdir(parents=True, exist_ok=True)
            return
        for path in skills_path.glob("*.md"):
            skill = self._loader.parse_file(str(path))
            await registry.register(skill)

    async def load_skill(self, path: str, registry: LocalToolRegistry) -> SkillDefinition:
        skill = self._loader.parse_file(path)
        await registry.register(skill)
        dest = Path(self._skills_dir) / Path(path).name
        Path(self._skills_dir).mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, str(dest))
        return skill
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/tools/test_skill_store.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/tools/skill_store.py tests/unit/core/tools/test_skill_store.py
git commit -m "feat: add SkillStore for loading and persisting skill definitions"
```

---

### Task 3: CabinetConfig 扩展 + KnowledgeBase 注入 + LLMAgentFactory employee_store

**Files:**
- Modify: `src/cabinet/cli/config.py`
- Modify: `src/cabinet/cli/main.py`
- Modify: `src/cabinet/agents/llm_factory.py`
- Modify: `src/cabinet/runtime.py`
- Test: `tests/unit/cli/test_config.py`
- Test: `tests/unit/agents/test_llm_factory.py`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cli/test_config.py`:

```python
def test_cabinet_config_has_new_paths():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.employees_path == "data/employees.json"
    assert config.skills_dir == "data/skills"
    assert config.knowledge_dir == "data/knowledge"


def test_cabinet_config_roundtrip_with_new_paths(tmp_path):
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        employees_path="custom/employees.json",
        skills_dir="custom/skills",
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert loaded.employees_path == "custom/employees.json"
    assert loaded.skills_dir == "custom/skills"
```

Add to `tests/unit/agents/test_llm_factory.py`:

```python
@pytest.mark.asyncio
async def test_create_agent_with_employee_store():
    from unittest.mock import AsyncMock
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.models.primitives import Employee

    gateway = MockGateway(responses=["Hello from registered employee"])
    store = AsyncMock(spec=JsonEmployeeStore)
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="注册顾问", role="advisor", kind="ai",
        personality="Custom personality for registered employee",
    )
    store.get = AsyncMock(return_value=employee)
    factory = LLMAgentFactory(gateway, employee_store=store)
    agent = await factory.create_agent(employee.id, "advisor")
    assert agent.employee.name == "注册顾问"
    assert agent._system_prompt == "Custom personality for registered employee"


@pytest.mark.asyncio
async def test_create_agent_falls_back_when_not_in_store():
    from unittest.mock import AsyncMock
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["fallback"])
    store = AsyncMock(spec=JsonEmployeeStore)
    store.get = AsyncMock(return_value=None)
    factory = LLMAgentFactory(gateway, employee_store=store)
    agent = await factory.create_agent(uuid4(), "advisor")
    assert agent.employee.role == "advisor"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/cli/test_config.py::test_cabinet_config_has_new_paths tests/unit/agents/test_llm_factory.py::test_create_agent_with_employee_store -v`
Expected: FAIL

- [ ] **Step 3: Update CabinetConfig**

Modify `src/cabinet/cli/config.py` — add 3 fields:

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    employees_path: str = "data/employees.json"
    skills_dir: str = "data/skills"
    knowledge_dir: str = "data/knowledge"
    created_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 4: Update LLMAgentFactory**

Modify `src/cabinet/agents/llm_factory.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam
from cabinet.agents.protocol import BaseAgent
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.models.primitives import Employee, Team

if TYPE_CHECKING:
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.core.memory.protocol import MemoryStore


DEFAULT_ROLE_PROMPTS: dict[str, str] = {
    "secretary": (
        "You are the Secretary Agent of Cabinet, Captain's first mate and sole interface. "
        "Your tone: respectful but not sycophantic, professional but not cold. "
        "Always address the user as 'Captain'. "
        "Your duties: parse natural language instructions, generate decision cards, "
        "summarize pending items, filter decisions by authorization rules, "
        "and notify Captain of important events."
    ),
    "advisor": (
        "You are an advisor in the Meeting Room. "
        "Provide thoughtful, multi-perspective analysis on the given topic. "
        "Consider risks, opportunities, and trade-offs. "
        "Be concise but thorough."
    ),
    "validator": (
        "You are a cross-validation agent. "
        "Compare multiple perspectives, identify consensus and dissent. "
        "Highlight unresolved disagreements that need Captain's attention."
    ),
    "strategist": (
        "You are a strategy decoder. "
        "Transform strategic proposals into structured action blueprints. "
        "Define action domains, goals, constraints, success criteria, and dependencies."
    ),
    "executor": (
        "You are an execution agent in the Office. "
        "Execute tasks efficiently and report status. "
        "Flag any issues or blockers immediately."
    ),
    "evaluator": (
        "You are an independent quality evaluator. "
        "Verify outputs, challenge assumptions, and discover gaps. "
        "Be rigorous but constructive."
    ),
}


class LLMAgentFactory:
    def __init__(
        self,
        gateway: ModelGateway,
        role_prompts: dict[str, str] | None = None,
        memory_store: MemoryStore | None = None,
        employee_store: JsonEmployeeStore | None = None,
    ):
        self._gateway = gateway
        self._role_prompts = role_prompts or DEFAULT_ROLE_PROMPTS
        self._memory_store = memory_store
        self._employee_store = employee_store

    async def create_agent(self, agent_id: UUID, role: str) -> LiteLLMAgent:
        if self._employee_store is not None:
            registered = await self._employee_store.get(agent_id)
            if registered is not None:
                prompt = registered.personality or self._role_prompts.get(role, "")
                return LiteLLMAgent(
                    registered, self._gateway, system_prompt=prompt, memory_store=self._memory_store
                )

        prompt = self._role_prompts.get(role, "")
        employee = Employee(
            id=agent_id,
            team_id=uuid4(),
            name=f"agent-{role}",
            role=role,
            kind="ai",
            personality=prompt,
        )
        return LiteLLMAgent(
            employee, self._gateway, system_prompt=prompt, memory_store=self._memory_store
        )

    async def create_team(self, agents: list[BaseAgent], task: str) -> LLMTeam:
        team = Team(
            project_id=uuid4(),
            name=f"team-{task[:20]}",
            purpose=task,
            employees=[a.employee.id for a in agents],
        )
        return LLMTeam(team, agents, self._gateway)
```

- [ ] **Step 5: Update _init_runtime to inject KnowledgeBase and employee_store**

Modify `src/cabinet/cli/main.py` — update `_init_runtime`:

```python
async def _init_runtime(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
    from cabinet.core.tools.skill_store import SkillStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    for provider, key in config.api_keys.items():
        os.environ.setdefault(f"{provider.upper()}_API_KEY", key)

    model_list = _load_model_list(data_dir, config)
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)

    memory_store = SQLiteMemoryStore(db_path=db_path)

    employee_store = JsonEmployeeStore(
        path=os.path.join(data_dir, config.employees_path)
    )
    await employee_store.initialize()

    agent_factory = LLMAgentFactory(
        gateway, memory_store=memory_store, employee_store=employee_store
    )

    knowledge_base = ChromaDBKnowledgeBase(
        persist_dir=os.path.join(data_dir, "vectors"),
    )

    kwargs: dict = {
        "agent_factory": agent_factory,
        "db_path": db_path,
        "memory_store": memory_store,
        "gateway": gateway,
        "knowledge_base": knowledge_base,
    }
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector

        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)

    skill_store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    await skill_store.initialize(runtime.tool_registry)

    await runtime.start()
    return runtime, config
```

- [ ] **Step 6: Add employee_store to CabinetRuntime**

Modify `src/cabinet/runtime.py` — add `employee_store` parameter and property:

In `__init__`, add parameter:
```python
def __init__(
    self,
    agent_factory: AgentFactory | None = None,
    gateway: object | None = None,
    db_path: str | None = None,
    mcp_connector: MCPConnector | None = None,
    knowledge_base: KnowledgeBase | None = None,
    memory_store: MemoryStore | None = None,
    tool_registry: ToolRegistry | None = None,
    employee_store: object | None = None,
):
```

Add `self._employee_store = employee_store` in body.

Add property:
```python
@property
def employee_store(self):
    return self._employee_store
```

- [ ] **Step 7: Run all tests to verify they pass**

Run: `python -m pytest tests/unit/cli/test_config.py tests/unit/agents/test_llm_factory.py tests/unit/cli/test_main.py -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src/cabinet/cli/config.py src/cabinet/agents/llm_factory.py src/cabinet/cli/main.py src/cabinet/runtime.py tests/unit/cli/test_config.py tests/unit/agents/test_llm_factory.py
git commit -m "feat: extend CabinetConfig, inject KnowledgeBase and employee_store into runtime"
```

---

### Task 4: CLI employee/skill/knowledge 命令

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cli/test_main.py`:

```python
def test_employee_add():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, [
            "employee", "add", "--name", "策略顾问", "--role", "advisor",
            "--data-dir", tmpdir,
        ])
        assert result.exit_code == 0
        assert "策略顾问" in result.output


def test_employee_list():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        runner.invoke(app, [
            "employee", "add", "--name", "顾问A", "--role", "advisor",
            "--data-dir", tmpdir,
        ])
        result = runner.invoke(app, ["employee", "list", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "顾问A" in result.output


def test_skill_load(tmp_path):
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        skill_file = tmp_path / "test_skill.md"
        skill_file.write_text("""---
name: test_skill
description: A test skill
input_schema:
  type: object
output_schema:
  type: object
---

Do something
""")
        result = runner.invoke(app, ["skill", "load", str(skill_file), "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "test_skill" in result.output


def test_skill_list():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["skill", "list", "--data-dir", tmpdir])
        assert result.exit_code == 0


def test_knowledge_index(tmp_path):
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        doc_file = tmp_path / "doc.md"
        doc_file.write_text("# Test Document\n\nThis is test content for knowledge base.")
        result = runner.invoke(app, ["knowledge", "index", str(doc_file), "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "indexed" in result.output.lower() or "Indexed" in result.output


def test_knowledge_query_without_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["knowledge", "query", "test question", "--data-dir", tmpdir])
        assert result.exit_code == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/cli/test_main.py::test_employee_add -v`
Expected: FAIL with unknown command

- [ ] **Step 3: Implement employee command group**

Modify `src/cabinet/cli/main.py` — add employee app and commands:

```python
employee_app = typer.Typer(name="employee", help="Manage employees")
app.add_typer(employee_app, name="employee")


@employee_app.command("add")
def employee_add(
    name: str = typer.Option(..., "--name", help="Employee name"),
    role: str = typer.Option(..., "--role", help="Employee role"),
    personality: str = typer.Option("", "--personality", help="Employee personality"),
    kind: str = typer.Option("ai", "--kind", help="Employee kind (ai/human)"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_employee_add_async(name, role, personality, kind, data_dir))


async def _employee_add_async(name: str, role: str, personality: str, kind: str, data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import DEFAULT_ROLE_PROMPTS
    from cabinet.cli.config import load_config
    from cabinet.models.primitives import Employee
    from uuid import uuid5, NAMESPACE_DNS

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
    await store.initialize()

    team_id = uuid5(NAMESPACE_DNS, f"team:{role}")
    emp_personality = personality or DEFAULT_ROLE_PROMPTS.get(role, "")
    employee = Employee(
        team_id=team_id,
        name=name,
        role=role,
        kind=kind,
        personality=emp_personality,
    )
    await store.add(employee)
    console.print(f"[green]Employee '{name}' added.[/green] (ID: {employee.id}, Role: {role})")


@employee_app.command("list")
def employee_list(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_employee_list_async(data_dir))


async def _employee_list_async(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.cli.config import load_config
    from rich.table import Table

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
    await store.initialize()
    employees = await store.list_all()

    table = Table(title="Employees")
    table.add_column("ID", style="dim")
    table.add_column("Name", style="cyan")
    table.add_column("Role", style="green")
    table.add_column("Kind")
    table.add_column("Skills", style="yellow")

    for emp in employees:
        table.add_row(
            str(emp.id)[:8],
            emp.name,
            emp.role,
            emp.kind,
            str(len(emp.skills)),
        )
    console.print(table)
```

- [ ] **Step 4: Implement skill command group**

Add to `src/cabinet/cli/main.py`:

```python
skill_app = typer.Typer(name="skill", help="Manage skills")
app.add_typer(skill_app, name="skill")


@skill_app.command("load")
def skill_load(
    path: str = typer.Argument(..., help="Path to skill markdown file"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_skill_load_async(path, data_dir))


async def _skill_load_async(path: str, data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.tools.registry import LocalToolRegistry
    from cabinet.core.tools.skill_store import SkillStore

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    registry = LocalToolRegistry()
    store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    skill = await store.load_skill(path, registry)
    console.print(f"[green]Skill '{skill.name}' loaded.[/green]")


@skill_app.command("list")
def skill_list(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_skill_list_async(data_dir))


async def _skill_list_async(data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.tools.registry import LocalToolRegistry
    from cabinet.core.tools.skill_store import SkillStore
    from rich.table import Table

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    registry = LocalToolRegistry()
    store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    await store.initialize(registry)
    skills = await registry.list_skills()

    table = Table(title="Skills")
    table.add_column("Name", style="cyan")
    table.add_column("Kind", style="green")
    table.add_column("Description")
    table.add_column("Knowledge", style="yellow")

    for s in skills:
        table.add_row(
            s.name,
            s.kind,
            s.description[:50],
            "Yes" if s.requires_knowledge else "No",
        )
    console.print(table)


@skill_app.command("run")
def skill_run(
    name: str = typer.Argument(..., help="Skill name to execute"),
    inputs: list[str] = typer.Option([], "--input", "-i", help="Input key=value"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    parsed_inputs = {}
    for item in inputs:
        k, v = item.split("=", 1)
        parsed_inputs[k] = v

    asyncio.run(_skill_run_async(name, parsed_inputs, data_dir))


async def _skill_run_async(name: str, inputs: dict, data_dir: str):
    runtime, config = await _init_runtime(data_dir)
    try:
        output = await runtime.tool_registry.execute(name, inputs)
        console.print(Panel(output.content, title=f"Skill: {name}"))
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
    finally:
        await runtime.stop()
```

- [ ] **Step 5: Implement knowledge command group**

Add to `src/cabinet/cli/main.py`:

```python
knowledge_app = typer.Typer(name="knowledge", help="Manage knowledge base")
app.add_typer(knowledge_app, name="knowledge")


@knowledge_app.command("index")
def knowledge_index(
    path: str = typer.Argument(..., help="Path to file or directory to index"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_knowledge_index_async(path, data_dir))


async def _knowledge_index_async(path: str, data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    kb = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))

    p = Path(path)
    documents = []
    if p.is_file():
        content = p.read_text(encoding="utf-8")
        documents.append({"content": content, "source": str(p)})
    elif p.is_dir():
        for f in p.rglob("*.md"):
            content = f.read_text(encoding="utf-8")
            documents.append({"content": content, "source": str(f)})
        for f in p.rglob("*.txt"):
            content = f.read_text(encoding="utf-8")
            documents.append({"content": content, "source": str(f)})

    if not documents:
        console.print("[yellow]No documents found to index.[/yellow]")
        return

    await kb.index(documents)
    console.print(f"[green]Indexed {len(documents)} document(s).[/green]")


@knowledge_app.command("query")
def knowledge_query(
    question: str = typer.Argument(..., help="Question to ask"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_knowledge_query_async(question, data_dir))


async def _knowledge_query_async(question: str, data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    kb = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))
    chunks = await kb.query(question, top_k=3)

    if not chunks:
        console.print("[yellow]No results found.[/yellow]")
        return

    for i, chunk in enumerate(chunks, 1):
        console.print(Panel(
            chunk.content[:500],
            title=f"Result {i} (source: {chunk.source})",
        ))
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: add employee/skill/knowledge CLI commands"
```

---

### Task 5: LiteLLMAgent 流式输出 + Secretary 流式方法

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`
- Modify: `src/cabinet/rooms/secretary/service.py`
- Test: `tests/unit/agents/test_llm_agent.py`
- Test: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/agents/test_llm_agent.py`:

```python
@pytest.mark.asyncio
async def test_execute_stream_yields_chunks():
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.agents.context import AgentContext
    from cabinet.models.primitives import Employee

    class StreamingGateway:
        async def complete(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelResponse
            return ModelResponse(content="full response", model=model)

        async def stream(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelChunk
            yield ModelChunk(content="Hello ", model=model)
            yield ModelChunk(content="Captain", model=model)

        def list_models(self):
            return []

    gateway = StreamingGateway()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext(model="default", temperature=0.7)

    chunks = []
    async for chunk in agent.execute_stream("test task", context):
        chunks.append(chunk)

    assert chunks == ["Hello ", "Captain"]
    assert len(agent._history) == 2
    assert agent._history[-1]["content"] == "Hello Captain"
```

Add to `tests/unit/rooms/secretary/test_service.py`:

```python
@pytest.mark.asyncio
async def test_process_input_stream_returns_streaming_response(publisher):
    from unittest.mock import AsyncMock
    from cabinet.rooms.secretary.service import SecretaryAgentService
    from cabinet.rooms.secretary.models import InteractionContext

    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input_stream("hello", context)
    assert hasattr(response, "stream")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_execute_stream_yields_chunks -v`
Expected: FAIL with `AttributeError: 'LiteLLMAgent' object has no attribute 'execute_stream'`

- [ ] **Step 3: Add execute_stream to LiteLLMAgent**

Modify `src/cabinet/agents/llm_agent.py` — add `_build_messages` method and `execute_stream`, refactor `execute`:

```python
def _build_messages(self, task: str) -> list[dict]:
    messages = [{"role": "system", "content": self._system_prompt}]
    messages.extend(self._history)
    messages.append({"role": "user", "content": task})
    return messages

async def execute(self, task: str, context: AgentContext) -> AgentOutput:
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
    response = await self._gateway.complete(
        messages=messages,
        model=context.model,
        temperature=context.temperature,
    )
    self._history.append({"role": "user", "content": task})
    self._history.append({"role": "assistant", "content": response.content})

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

async def execute_stream(self, task: str, context: AgentContext):
    messages = self._build_messages(task)
    full_content: list[str] = []
    async for chunk in self._gateway.stream(
        messages=messages, model=context.model, temperature=context.temperature
    ):
        full_content.append(chunk.content)
        yield chunk.content
    self._history.append({"role": "user", "content": task})
    self._history.append({"role": "assistant", "content": "".join(full_content)})
```

Note: `execute()` keeps its existing memory search logic unchanged. `execute_stream()` uses `_build_messages()` which is simpler (no memory search) — streaming is for Chat where Secretary already injects memory context into the prompt.

- [ ] **Step 4: Add process_input_stream to SecretaryAgentService**

Modify `src/cabinet/rooms/secretary/service.py` — add `StreamingSecretaryResponse` and `process_input_stream`:

```python
class StreamingSecretaryResponse:
    def __init__(self, stream, finalize):
        self.stream = stream
        self._finalize = finalize

    async def finalize(self):
        await self._finalize()
```

Add method to `SecretaryAgentService`:

```python
async def process_input_stream(
    self,
    captain_input: str,
    context: InteractionContext,
) -> StreamingSecretaryResponse:
    knowledge_context = ""
    if self._knowledge_base is not None:
        chunks = await self._knowledge_base.query(captain_input, top_k=3)
        knowledge_context = "\n".join(c.content for c in chunks)

    memory_context = ""
    if self._memory_store is not None:
        from cabinet.models.primitives import MemoryScope

        items = await self._memory_store.search(
            context.captain_id,
            MemoryScope.LONG_TERM,
            limit=3,
        )
        memory_context = "\n".join(item.content for item in items)

    agent = await self._agent_factory.create_agent(uuid4(), "secretary")
    agent_context = AgentContext(model="default", temperature=0.7)
    prompt = f"Captain says: {captain_input}\n\n"
    if knowledge_context:
        prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
    if memory_context:
        prompt += f"Captain's preferences and history:\n{memory_context}\n\n"
    prompt += (
        "Parse this instruction and respond appropriately. "
        "If it's a question, answer it. If it's a task, acknowledge and plan. "
        "If it's ambiguous, ask for clarification."
    )

    collected_chunks: list[str] = []

    async def _stream_and_collect():
        async for chunk in agent.execute_stream(prompt, agent_context):
            collected_chunks.append(chunk)
            yield chunk

    async def _finalize():
        full_content = "".join(collected_chunks)
        event = InputProcessed(
            captain_id=context.captain_id,
            input_text=captain_input,
            response_text=full_content,
        )
        await self._publish_and_apply(event)

        if self._memory_store is not None:
            from uuid import uuid5, NAMESPACE_DNS
            from cabinet.models.primitives import MemoryItem, MemoryScope

            captain_uuid = uuid5(NAMESPACE_DNS, context.captain_id)
            await self._memory_store.store(
                f"interaction:{uuid4()}",
                MemoryItem(
                    owner_id=captain_uuid,
                    content=f"Captain: {captain_input}\nSecretary: {full_content}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"captain_id": context.captain_id, "type": "interaction"},
                ),
                MemoryScope.LONG_TERM,
            )

    return StreamingSecretaryResponse(
        stream=_stream_and_collect(),
        finalize=_finalize,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_execute_stream_yields_chunks tests/unit/rooms/secretary/test_service.py::test_process_input_stream_returns_streaming_response -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/agents/llm_agent.py src/cabinet/rooms/secretary/service.py tests/unit/agents/test_llm_agent.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: add streaming support to LiteLLMAgent and Secretary"
```

---

### Task 6: Chat 斜杠命令 + 流式输出

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cli/test_main.py`:

```python
def test_help_shows_employee_and_skill_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "employee" in result.output
    assert "skill" in result.output
    assert "knowledge" in result.output
```

- [ ] **Step 2: Run test to verify it passes** (should already pass after Task 4)

Run: `python -m pytest tests/unit/cli/test_main.py::test_help_shows_employee_and_skill_commands -v`

- [ ] **Step 3: Implement slash command routing in _chat_async**

Modify `src/cabinet/cli/main.py` — replace the `_chat_async` function with slash command support:

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.rooms.secretary.models import InteractionContext
    from rich.markdown import Markdown
    from rich.prompt import Prompt

    runtime, config = await _init_runtime(data_dir)

    try:
        greeting = await runtime.secretary.greet(captain_id=config.organization.captain_id)
        console.print(Panel(greeting.message, title="Secretary"))
        console.print()
        console.print("[dim]Type /help for available commands.[/dim]\n")

        while True:
            try:
                user_input = Prompt.ask("[bold cyan]Captain[/bold cyan]")
            except (EOFError, KeyboardInterrupt):
                break

            stripped = user_input.strip()
            if stripped == "/quit":
                break
            if stripped == "/status":
                summary = await runtime.secretary.summarize_pending(
                    captain_id=config.organization.captain_id
                )
                console.print(Markdown(summary.digest))
                console.print()
                continue
            if stripped == "/help":
                _print_help()
                continue
            if stripped.startswith("/meeting "):
                await _handle_meeting(runtime, stripped[9:])
                continue
            if stripped.startswith("/decide "):
                await _handle_decide(runtime, stripped[8:])
                continue
            if stripped.startswith("/task "):
                await _handle_task(runtime, stripped[6:])
                continue
            if stripped.startswith("/strategy "):
                await _handle_strategy(runtime, stripped[10:])
                continue
            if stripped == "/review":
                await _handle_review(runtime, config)
                continue
            if stripped == "/skills":
                await _handle_skills(runtime)
                continue
            if stripped == "/employees":
                await _handle_employees(runtime)
                continue
            if not stripped:
                continue

            try:
                response = await runtime.secretary.process_input_stream(
                    captain_input=stripped,
                    context=InteractionContext(
                        captain_id=config.organization.captain_id,
                        channel="terminal",
                    ),
                )
                async for chunk in response.stream:
                    console.print(chunk, end="")
                await response.finalize()
                console.print("\n")
            except Exception as e:
                console.print(f"[red]Error:[/red] {e}")
    finally:
        await runtime.stop()


def _print_help():
    from rich.table import Table

    table = Table(title="Available Commands")
    table.add_column("Command", style="cyan")
    table.add_column("Description", style="green")
    commands = [
        ("/meeting <topic>", "Start a deliberation session"),
        ("/decide <title>", "Submit a decision request"),
        ("/task <description>", "Submit an execution task"),
        ("/strategy <proposal>", "Decode a strategy proposal"),
        ("/review", "Start a review session"),
        ("/skills", "List available skills"),
        ("/employees", "List registered employees"),
        ("/status", "Show pending summary"),
        ("/help", "Show this help"),
        ("/quit", "Exit chat"),
    ]
    for cmd, desc in commands:
        table.add_row(cmd, desc)
    console.print(table)


async def _handle_meeting(runtime, topic: str):
    from cabinet.rooms.meeting.models import MeetingLevel
    from rich.markdown import Markdown

    participants = [uuid4(), uuid4()]
    session = await runtime.meeting.start_session(
        topic=topic, level=MeetingLevel.MULTI_PARTY, participants=participants
    )
    console.print(f"[dim]Deliberation session started: {session.id}[/dim]")
    for pid in participants:
        await runtime.meeting.add_perspective(session.id, pid)
    await runtime.meeting.cross_validate(session.id)
    result = await runtime.meeting.converge(session.id)
    console.print(Markdown(result.proposal_text))
    console.print()


async def _handle_decide(runtime, title: str):
    from cabinet.models.events import DecisionRequest
    from cabinet.models.decisions import DecisionType
    from rich.markdown import Markdown

    request = DecisionRequest(
        decision_id=uuid4(),
        decision_type=DecisionType.STRATEGIC.value,
        title=title,
        options=[{"label": "Approve"}, {"label": "Reject"}],
    )
    decision = await runtime.decision.submit(request)
    console.print(Markdown(f"**Decision submitted:** {decision.title}\n\n{decision.description[:200]}"))
    console.print()


async def _handle_task(runtime, description: str):
    from cabinet.models.events import TaskOrder
    from rich.markdown import Markdown

    order = TaskOrder(
        employee_id=uuid4(),
        skill_id=uuid4(),
        inputs={"description": description},
    )
    task = await runtime.office.submit_task(order)
    console.print(Markdown(f"**Task submitted:** {task.id}\nStatus: {task.status}"))
    console.print()


async def _handle_strategy(runtime, proposal: str):
    from cabinet.rooms.strategy.models import DecodeContext
    from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult
    from cabinet.rooms.meeting.models import ConvergenceResult
    from rich.markdown import Markdown

    session_id = uuid4()
    proposal_output = DeliberationOutput(
        session_id=session_id,
        proposal=DeliberationResult(
            session_id=session_id,
            proposal_text=proposal,
            confidence=0.8,
            reasoning_summary="direct input",
            convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
            rounds_used=1,
            rumination_detected=False,
        ),
    )
    context = DecodeContext(project_id=uuid4(), captain_id="captain", existing_constraints=[])
    blueprint = await runtime.strategy.decode(proposal_output, context)
    console.print(Markdown(f"**Blueprint decoded:** {blueprint.id}\nDomains: {', '.join(d.name for d in blueprint.domains)}"))
    console.print()


async def _handle_review(runtime, config):
    from cabinet.rooms.summary.models import ReviewType
    from rich.markdown import Markdown

    session = await runtime.summary.start_review(
        project_id=config.default_project, review_type=ReviewType.PROJECT
    )
    insights = await runtime.summary.generate_insights(session.id)
    for insight in insights:
        console.print(Markdown(f"- {insight.content}"))
    console.print()


async def _handle_skills(runtime):
    from rich.table import Table

    skills = await runtime.tool_registry.list_skills()
    table = Table(title="Available Skills")
    table.add_column("Name", style="cyan")
    table.add_column("Description")
    for s in skills:
        table.add_row(s.name, s.description[:60])
    if not skills:
        console.print("[yellow]No skills loaded. Use 'cabinet skill load <path>' to add skills.[/yellow]")
    else:
        console.print(table)


async def _handle_employees(runtime):
    from rich.table import Table

    if runtime.employee_store is None:
        console.print("[yellow]No employee store configured.[/yellow]")
        return
    employees = await runtime.employee_store.list_all()
    table = Table(title="Registered Employees")
    table.add_column("Name", style="cyan")
    table.add_column("Role", style="green")
    table.add_column("Kind")
    for emp in employees:
        table.add_row(emp.name, emp.role, emp.kind)
    if not employees:
        console.print("[yellow]No employees registered. Use 'cabinet employee add' to add employees.[/yellow]")
    else:
        console.print(table)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: add chat slash commands and streaming output"
```

---

### Task 7: init 增强 + 最终验证

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli/test_main.py`:

```python
def test_init_creates_skills_dir_and_employees_json():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert os.path.isdir(os.path.join(tmpdir, "skills"))
        assert os.path.exists(os.path.join(tmpdir, "employees.json"))


def test_init_output_mentions_skill_and_employee():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "skill" in result.output.lower()
        assert "employee" in result.output.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_creates_skills_dir_and_employees_json -v`
Expected: FAIL (skills dir and employees.json not created by init)

- [ ] **Step 3: Update init command**

Modify `src/cabinet/cli/main.py` — update the `init` command:

In the `init` function, after creating directories, add:
```python
Path(os.path.join(data_dir, "skills")).mkdir(parents=True, exist_ok=True)

import json as _json
employees_path = os.path.join(data_dir, "employees.json")
with open(employees_path, "w") as f:
    _json.dump([], f)
```

Also copy the hello_world.md sample skill:
```python
import shutil
sample_src = os.path.join(
    os.path.dirname(__file__), "..", "core", "tools", "samples", "hello_world.md"
)
if os.path.exists(sample_src):
    shutil.copy2(sample_src, os.path.join(data_dir, "skills", "hello_world.md"))
```

Update the Next steps panel:
```python
console.print(
    Panel(
        f"[bold green]Cabinet initialized![/bold green]\n\n"
        f"Organization: {name}\n"
        f"Captain ID: captain\n"
        f"Data directory: {data_dir}\n\n"
        f"[bold]Next steps:[/bold]\n"
        f"1. Configure API keys:  cabinet config set-key openai sk-xxx\n"
        f"2. Edit model list:     {os.path.join(data_dir, 'models.json')}\n"
        f"3. Load a skill:        cabinet skill load <path>\n"
        f"4. Add an employee:     cabinet employee add --name '顾问' --role advisor\n"
        f"5. Start chatting:      cabinet chat",
        title="Cabinet Init",
    )
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: All PASS

- [ ] **Step 5: Run full test suite + lint**

Run: `python -m pytest tests/ -v --tb=short`
Run: `python -m ruff check src/ tests/`

- [ ] **Step 6: Fix any lint/test issues**

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: enhance init with skills dir, employees.json, and updated guidance"
```
