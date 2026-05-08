import pytest

from uuid import uuid4

from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.runtime import CabinetRuntime
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.models import MeetingLevel
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.service import SummaryRoomService


def test_runtime_creates_with_default_agent_factory():
    runtime = CabinetRuntime()
    assert isinstance(runtime._agent_factory, AgentFactory)


def test_runtime_creates_with_custom_agent_factory():
    factory = StubAgentFactory()
    runtime = CabinetRuntime(agent_factory=factory)
    assert runtime._agent_factory is factory


def test_runtime_exposes_bus():
    runtime = CabinetRuntime()
    assert isinstance(runtime.bus, AsyncIOEventBus)


def test_runtime_exposes_wiring():
    runtime = CabinetRuntime()
    assert isinstance(runtime.wiring, RoomEventWiring)


def test_runtime_exposes_store():
    runtime = CabinetRuntime()
    from cabinet.core.events.store import EventStore
    assert isinstance(runtime.store, EventStore)


def test_runtime_exposes_meeting_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.meeting, MeetingRoomService)


def test_runtime_exposes_strategy_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.strategy, StrategyDecoderService)


def test_runtime_exposes_decision_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.decision, DecisionRoomService)


def test_runtime_exposes_office_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.office, OfficeSchedulerService)


def test_runtime_exposes_summary_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.summary, SummaryRoomService)


def test_runtime_exposes_secretary_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.secretary, SecretaryAgentService)


def test_runtime_each_service_has_own_store():
    runtime = CabinetRuntime()
    assert runtime.meeting._store is not runtime.decision._store
    assert runtime.decision._store is not runtime.office._store
    assert runtime.office._store is not runtime.summary._store
    assert runtime.summary._store is not runtime.secretary._store


def test_runtime_all_services_share_same_publisher():
    runtime = CabinetRuntime()
    assert runtime.meeting._publisher is runtime.decision._publisher
    assert runtime.decision._publisher is runtime.office._publisher
    assert runtime.office._publisher is runtime.wiring


@pytest.mark.asyncio
async def test_runtime_start_registers_handlers():
    runtime = CabinetRuntime()
    await runtime.start()
    assert "meeting" in runtime.wiring._handlers
    assert "strategy" in runtime.wiring._handlers
    assert "decision" in runtime.wiring._handlers
    assert "office" in runtime.wiring._handlers
    assert "summary" in runtime.wiring._handlers
    assert "secretary" in runtime.wiring._handlers


@pytest.mark.asyncio
async def test_runtime_stop_completes_without_error():
    runtime = CabinetRuntime()
    await runtime.start()
    await runtime.stop()


def test_runtime_creates_harness_components():
    from cabinet.core.harness.evaluator import DefaultEvaluator
    from cabinet.core.harness.verification_gate import WorkflowVerificationGate
    from cabinet.core.harness.escalation import DefaultEscalationProtocol

    runtime = CabinetRuntime()
    assert isinstance(runtime.evaluator, DefaultEvaluator)
    assert isinstance(runtime.verification_gate, WorkflowVerificationGate)
    assert isinstance(runtime.escalation_protocol, DefaultEscalationProtocol)


def test_runtime_injects_verification_gate_into_office():
    runtime = CabinetRuntime()
    assert runtime.office._verification_gate is runtime.verification_gate


def test_runtime_injects_escalation_protocol_into_decision():
    runtime = CabinetRuntime()
    assert runtime.decision._escalation_protocol is runtime.escalation_protocol


def test_runtime_with_gateway_creates_evaluator_with_gateway():
    from unittest.mock import AsyncMock
    from cabinet.core.gateway.protocol import ModelGateway

    gateway = AsyncMock(spec=ModelGateway)
    runtime = CabinetRuntime(gateway=gateway)
    assert runtime.evaluator._gateway is gateway


def test_runtime_creates_workflow_engine():
    from cabinet.core.workflow.engine import WorkflowEngine

    runtime = CabinetRuntime()
    assert isinstance(runtime.workflow_engine, WorkflowEngine)


def test_runtime_injects_workflow_engine_into_office():
    runtime = CabinetRuntime()
    assert runtime.office._workflow_engine is runtime.workflow_engine


@pytest.mark.asyncio
async def test_runtime_stop_clears_handlers():
    runtime = CabinetRuntime()
    await runtime.start()
    assert len(runtime.wiring._handlers) == 6
    await runtime.stop()
    assert len(runtime.wiring._handlers) == 0


@pytest.mark.asyncio
async def test_runtime_with_db_path_creates_sqlite_stores(tmp_path):
    from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore
    from cabinet.core.events.sqlite_store import SqliteEventStore

    db_path = str(tmp_path / "runtime.db")
    runtime = CabinetRuntime(db_path=db_path)
    await runtime.start()
    assert isinstance(runtime._event_store, SqliteEventStore)
    assert isinstance(runtime.meeting._store, SqliteRoomEventStore)
    assert isinstance(runtime.decision._store, SqliteRoomEventStore)
    await runtime.stop()


@pytest.mark.asyncio
async def test_runtime_without_db_path_uses_memory_stores():
    from cabinet.core.events.event_sourced import RoomEventStore
    from cabinet.core.events.store import EventStore

    runtime = CabinetRuntime()
    assert isinstance(runtime._event_store, EventStore)
    assert isinstance(runtime.meeting._store, RoomEventStore)


@pytest.mark.asyncio
async def test_runtime_persistence_across_restart(tmp_path):
    db_path = str(tmp_path / "persist.db")
    pid = uuid4()
    p1 = uuid4()

    rt1 = CabinetRuntime(db_path=db_path)
    await rt1.start()
    session = await rt1.meeting.start_session(
        "persist test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid,
    )
    await rt1.meeting.add_perspective(session.id, uuid4(), "view1")
    await rt1.stop()

    rt2 = CabinetRuntime(db_path=db_path)
    await rt2.start()
    assert session.id in rt2.meeting._sessions
    assert len(rt2.meeting._perspectives[session.id]) == 1
    await rt2.stop()


def test_runtime_creates_with_default_tool_registry():
    from cabinet.core.tools.registry import LocalToolRegistry
    runtime = CabinetRuntime()
    assert isinstance(runtime._tool_registry, LocalToolRegistry)


def test_runtime_mcp_connector_defaults_none():
    runtime = CabinetRuntime()
    assert runtime._mcp_connector is None


def test_runtime_knowledge_base_defaults_none():
    runtime = CabinetRuntime()
    assert runtime._knowledge_base is None


def test_runtime_memory_store_defaults_none():
    runtime = CabinetRuntime()
    assert runtime._memory_store is None


def test_runtime_accepts_custom_tool_registry():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.protocol import ToolRegistry
    custom_registry = AsyncMock(spec=ToolRegistry)
    runtime = CabinetRuntime(tool_registry=custom_registry)
    assert runtime._tool_registry is custom_registry


def test_runtime_accepts_mcp_connector():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector
    connector = AsyncMock(spec=MCPConnector)
    runtime = CabinetRuntime(mcp_connector=connector)
    assert runtime._mcp_connector is connector


def test_runtime_accepts_knowledge_base():
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase
    kb = AsyncMock(spec=KnowledgeBase)
    runtime = CabinetRuntime(knowledge_base=kb)
    assert runtime._knowledge_base is kb


def test_runtime_accepts_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    ms = AsyncMock(spec=MemoryStore)
    runtime = CabinetRuntime(memory_store=ms)
    assert runtime._memory_store is ms


@pytest.mark.asyncio
async def test_runtime_start_initializes_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    ms = AsyncMock(spec=MemoryStore)
    ms.initialize = AsyncMock()
    runtime = CabinetRuntime(memory_store=ms)
    await runtime.start()
    ms.initialize.assert_called_once()
    await runtime.stop()


@pytest.mark.asyncio
async def test_runtime_stop_closes_mcp_connector():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector
    connector = AsyncMock(spec=MCPConnector)
    connector.disconnect_all = AsyncMock()
    runtime = CabinetRuntime(mcp_connector=connector)
    await runtime.start()
    await runtime.stop()
    connector.disconnect_all.assert_called_once()


@pytest.mark.asyncio
async def test_runtime_stop_closes_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    ms = AsyncMock(spec=MemoryStore)
    ms.initialize = AsyncMock()
    ms.close = AsyncMock()
    runtime = CabinetRuntime(memory_store=ms)
    await runtime.start()
    await runtime.stop()
    ms.close.assert_called_once()


def test_runtime_exposes_tool_registry():
    from cabinet.core.tools.registry import LocalToolRegistry
    runtime = CabinetRuntime()
    assert isinstance(runtime.tool_registry, LocalToolRegistry)


@pytest.mark.asyncio
async def test_runtime_discovers_mcp_tools_on_start():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector
    from cabinet.core.tools.protocol import SkillDefinition

    skill = SkillDefinition(
        name="mcp_tool_1",
        description="An MCP tool",
        kind="mcp",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Use mcp_tool_1",
    )
    connector = AsyncMock(spec=MCPConnector)
    connector.list_connected_servers = AsyncMock(return_value=["server1"])
    connector.discover_tools = AsyncMock(return_value=[skill])
    runtime = CabinetRuntime(mcp_connector=connector)
    await runtime.start()
    connector.list_connected_servers.assert_called_once()
    connector.discover_tools.assert_called_once_with("server1")
    assert "mcp_tool_1" in runtime.tool_registry._mcp_skill_names
    await runtime.stop()


@pytest.mark.asyncio
async def test_runtime_start_rollback_on_failure():
    from unittest.mock import patch

    runtime = CabinetRuntime()
    call_count = 0
    original_register = runtime._wiring.register

    async def failing_register(handler):
        nonlocal call_count
        call_count += 1
        await original_register(handler)
        if call_count >= 3:
            raise RuntimeError("init fail")

    with patch.object(runtime._wiring, "register", side_effect=failing_register):
        with pytest.raises(RuntimeError, match="init fail"):
            await runtime.start()
    assert len(runtime.wiring._handlers) == 0


@pytest.mark.asyncio
async def test_runtime_stop_safe_without_start():
    runtime = CabinetRuntime()
    await runtime.stop()


@pytest.mark.asyncio
async def test_preflight_check_returns_dict():
    runtime = CabinetRuntime(agent_factory=StubAgentFactory(), db_path=None)
    result = await runtime.preflight_check()
    assert isinstance(result, dict)
    assert "llm" in result
    assert "chromadb" in result
    assert "api_keys" in result


@pytest.mark.asyncio
async def test_preflight_check_llm_not_configured():
    runtime = CabinetRuntime(gateway=None, db_path=None)
    result = await runtime.preflight_check()
    assert result["llm"] == "not_configured"


@pytest.mark.asyncio
async def test_preflight_check_chromadb_not_configured():
    runtime = CabinetRuntime(memory_store=None, db_path=None)
    result = await runtime.preflight_check()
    assert result["chromadb"] == "not_configured"


@pytest.mark.asyncio
async def test_preflight_check_api_keys_no_keys():
    runtime = CabinetRuntime(db_path=None)
    result = await runtime.preflight_check()
    assert result["api_keys"] == "no_keys"


@pytest.mark.asyncio
async def test_health_check_gateway_degraded_when_none():
    runtime = CabinetRuntime(gateway=None, db_path=None)
    await runtime.start()
    result = await runtime.health_check()
    gateway_comp = [c for c in result["components"] if c["name"] == "llm_gateway"]
    assert len(gateway_comp) == 0
    await runtime.stop()


@pytest.mark.asyncio
async def test_runtime_wires_phase1_security_and_efficiency_components():
    from cabinet.core.harness.permissions import PermissionContext, PermissionMode

    runtime = CabinetRuntime()
    await runtime.start()

    assert runtime.permission_engine is not None
    assert runtime.sandbox is not None
    assert runtime.prompt_cache is not None
    assert runtime.cost_tracker is not None

    result = runtime.permission_engine.check(
        PermissionContext(
            tool_name="Read",
            mode=PermissionMode.AUTO,
        )
    )
    assert result.allowed

    await runtime.stop()
