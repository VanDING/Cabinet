import pytest
import aiosqlite
from uuid import uuid4

from cabinet.core.workflow.execution_store import WorkflowExecutionStore
from cabinet.rooms.office.models import WorkflowExecution


@pytest.fixture
async def db(tmp_path):
    db_path = str(tmp_path / "test.db")
    conn = await aiosqlite.connect(db_path)
    await conn.execute("PRAGMA journal_mode=WAL")
    yield conn
    await conn.close()


@pytest.fixture
async def store_with_tables(db):
    await db.execute("""
        CREATE TABLE IF NOT EXISTS workflow_executions (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            current_node_id TEXT,
            completed_nodes TEXT NOT NULL DEFAULT '[]',
            results TEXT NOT NULL DEFAULT '{}',
            gate_results TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS dead_letter_queue (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            source TEXT,
            payload TEXT NOT NULL,
            error TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_retry_at TEXT
        )
    """)
    await db.commit()
    yield db


@pytest.mark.asyncio
async def test_save_and_load_execution(store_with_tables):
    db = store_with_tables
    store = WorkflowExecutionStore(db)
    execution_id = uuid4()
    workflow_id = uuid4()
    project_id = uuid4()
    execution = WorkflowExecution(
        id=execution_id,
        workflow_id=workflow_id,
        project_id=project_id,
        status="running",
    )
    await store.save(execution)
    loaded = await store.load(execution_id)
    assert loaded is not None
    assert loaded.id == execution_id
    assert loaded.workflow_id == workflow_id
    assert loaded.status == "running"


@pytest.mark.asyncio
async def test_update_execution_status(store_with_tables):
    db = store_with_tables
    store = WorkflowExecutionStore(db)
    execution_id = uuid4()
    execution = WorkflowExecution(
        id=execution_id,
        workflow_id=uuid4(),
        project_id=uuid4(),
        status="running",
    )
    await store.save(execution)
    updated = execution.model_copy(update={"status": "completed"})
    await store.save(updated)
    loaded = await store.load(execution_id)
    assert loaded.status == "completed"


@pytest.mark.asyncio
async def test_load_nonexistent_returns_none(store_with_tables):
    db = store_with_tables
    store = WorkflowExecutionStore(db)
    result = await store.load(uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_list_by_workflow(store_with_tables):
    db = store_with_tables
    store = WorkflowExecutionStore(db)
    workflow_id = uuid4()
    for _ in range(3):
        execution = WorkflowExecution(
            workflow_id=workflow_id,
            project_id=uuid4(),
        )
        await store.save(execution)
    other = WorkflowExecution(
        workflow_id=uuid4(),
        project_id=uuid4(),
    )
    await store.save(other)
    results = await store.list_by_workflow(workflow_id)
    assert len(results) == 3
