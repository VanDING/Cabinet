import os
from uuid import uuid4

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
