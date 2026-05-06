from __future__ import annotations

import asyncio
import logging
import time as _time
from typing import TYPE_CHECKING

from cabinet import __version__
from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.agents.mailbox import MailboxRouter
from cabinet.agents.handoff import HandoffManager
from cabinet.agents.pool import AgentPool
from cabinet.agents.capability import CapabilityRegistry
from cabinet.agents.tools import ToolRegistryAdapter
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.store import EventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.core.harness.escalation import DefaultEscalationProtocol
from cabinet.core.harness.evaluator import DefaultEvaluator
from cabinet.core.harness.verification_gate import WorkflowVerificationGate
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.workflow.engine import WorkflowEngine

try:
    from cabinet.core.audit import AuditEvent, AuditStore

    _audit_store: AuditStore | None = None
except ImportError:
    _audit_store = None
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.service import SummaryRoomService

if TYPE_CHECKING:
    from cabinet.core.knowledge.protocol import KnowledgeBase
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.core.tools.mcp_connector import MCPConnector
    from cabinet.core.tools.protocol import ToolRegistry


logger = logging.getLogger(__name__)


class CabinetRuntime:
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
        api_keys: dict[str, str] | None = None,
    ):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._db_path = db_path
        self._gateway = gateway
        self._mcp_connector = mcp_connector
        self._knowledge_base = knowledge_base
        self._memory_store = memory_store
        self._tool_registry = tool_registry or LocalToolRegistry()
        self._employee_store = employee_store
        self._api_keys = api_keys or {}

        if self._mcp_connector is not None:
            self._tool_registry.set_mcp_connector(self._mcp_connector)

        if db_path:
            from cabinet.core.events.sqlite_store import SqliteEventStore
            from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore

            self._event_store = SqliteEventStore(db_path)
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = SqliteRoomEventStore("meeting", db_path)
            self._strategy_store = SqliteRoomEventStore("strategy", db_path)
            self._decision_store = SqliteRoomEventStore("decision", db_path)
            self._office_store = SqliteRoomEventStore("office", db_path)
            self._summary_store = SqliteRoomEventStore("summary", db_path)
            self._secretary_store = SqliteRoomEventStore("secretary", db_path)
        else:
            self._event_store = EventStore()
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = RoomEventStore("meeting")
            self._strategy_store = RoomEventStore("strategy")
            self._decision_store = RoomEventStore("decision")
            self._office_store = RoomEventStore("office")
            self._summary_store = RoomEventStore("summary")
            self._secretary_store = RoomEventStore("secretary")

        self._wiring = RoomEventWiring(self._bus)

        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])
        self._dead_letter_queue = None
        self._mailbox_router = MailboxRouter()
        self._handoff_manager = HandoffManager(self._mailbox_router)
        self._agent_pool = AgentPool(
            factory=self._agent_factory, mailbox_router=self._mailbox_router,
        )
        self._capability_registry = CapabilityRegistry(
            employee_store=self._employee_store or self._create_default_employee_store(),
            tool_registry=self._tool_registry,
        )
        self._tool_registry_adapter = ToolRegistryAdapter(self._tool_registry)
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
            knowledge_base=self._knowledge_base,
        )

        self._meeting = MeetingRoomService(self._meeting_store, self._wiring, self._agent_factory)
        self._strategy = StrategyDecoderService(
            self._strategy_store, self._wiring, self._agent_factory
        )
        self._decision = DecisionRoomService(
            self._decision_store,
            self._wiring,
            self._agent_factory,
            escalation_protocol=self._escalation_protocol,
            handoff_manager=self._handoff_manager,
        )
        self._office = OfficeSchedulerService(
            self._office_store,
            self._wiring,
            self._agent_factory,
            verification_gate=self._verification_gate,
            workflow_engine=self._workflow_engine,
        )
        self._summary = SummaryRoomService(self._summary_store, self._wiring, self._agent_factory)
        self._conversation_store = None
        if self._memory_store is not None:
            from cabinet.rooms.secretary.conversation import ConversationStore

            self._conversation_store = ConversationStore(self._memory_store)

        self._secretary = SecretaryAgentService(
            self._secretary_store,
            self._wiring,
            self._agent_factory,
            knowledge_base=self._knowledge_base,
            memory_store=self._memory_store,
            conversation_store=self._conversation_store,
        )

        self._meeting_handler = MeetingEventHandler()
        self._strategy_handler = StrategyEventHandler(self._strategy)
        self._decision_handler = DecisionEventHandler(self._decision)
        self._office_handler = OfficeEventHandler(self._office)
        self._summary_handler = SummaryEventHandler(self._summary)
        self._secretary_handler = SecretaryEventHandler(self._secretary)

        self._room_stores = [
            self._meeting_store,
            self._strategy_store,
            self._decision_store,
            self._office_store,
            self._summary_store,
            self._secretary_store,
        ]
        self._start_time = _time.monotonic()
        self._audit_store: AuditStore | None = None
        self._backup_task: asyncio.Task | None = None
        self._conn_manager = None

    async def start(self) -> None:
        logger.info("CabinetRuntime starting")
        try:
            await self._start_inner()
        except Exception:
            await self._rollback_init()
            raise

    async def _start_inner(self) -> None:
        if self._db_path:
            import os as _os
            from cabinet.core.events.migrations import MigrationRunner
            from cabinet.core.events.migrations.loader import load_all_migrations

            _migrations = load_all_migrations()

            runner = MigrationRunner(self._db_path, _migrations)
            await runner.initialize()
            await runner.run_pending()
            await runner.close()

            from cabinet.core.db.connection_manager import SharedConnectionManager

            self._conn_manager = SharedConnectionManager(self._db_path)
            await self._conn_manager.initialize()

            from cabinet.core.audit import AuditStore as _AuditStore

            self._audit_store = _AuditStore(
                _os.path.join(_os.path.dirname(self._db_path), "audit.db"),
            )
            await self._audit_store.initialize()

            from cabinet.core.workflow.dead_letter_queue import DeadLetterQueue

            self._dead_letter_queue = DeadLetterQueue(
                self._conn_manager.connection, conn_manager=self._conn_manager,
            )
            self._workflow_engine = WorkflowEngine(
                agent_factory=self._agent_factory,
                verification_gate=self._verification_gate,
                knowledge_base=self._knowledge_base,
                dead_letter_queue=self._dead_letter_queue,
                tool_registry=self._tool_registry,
            )
            self._office = OfficeSchedulerService(
                self._office_store,
                self._wiring,
                self._agent_factory,
                verification_gate=self._verification_gate,
                workflow_engine=self._workflow_engine,
            )
            self._office_handler = OfficeEventHandler(self._office)
        else:
            logger.info("audit disabled: no db_path configured")
        if self._audit_store is not None:
            await self._audit_store.log(AuditEvent(
                action="runtime.start", actor="system", resource_type="runtime", resource_id="cabinet",
            ))
        if self._db_path:
            await self._event_store.initialize()
            for store in self._room_stores:
                await store.initialize()
            await self._meeting.restore_from_events()
            await self._strategy.restore_from_events()
            await self._decision.restore_from_events()
            await self._office.restore_from_events()
            await self._summary.restore_from_events()
            await self._secretary.restore_from_events()
        if self._memory_store is not None:
            await self._memory_store.initialize()
        await self._wiring.register(self._meeting_handler)
        await self._wiring.register(self._strategy_handler)
        await self._wiring.register(self._decision_handler)
        await self._wiring.register(self._office_handler)
        await self._wiring.register(self._summary_handler)
        await self._wiring.register(self._secretary_handler)
        await self._discover_mcp_tools()
        if self._db_path:
            self._backup_task = asyncio.create_task(self._scheduled_backup())
        logger.info("CabinetRuntime started successfully")

    async def _rollback_init(self) -> None:
        logger.warning("CabinetRuntime init failed, rolling back")
        if self._backup_task is not None:
            self._backup_task.cancel()
        if self._audit_store is not None:
            try:
                await self._audit_store.close()
            except Exception:
                pass
        if self._dead_letter_queue is not None:
            try:
                await self._dead_letter_queue.close()
            except Exception:
                pass
        try:
            await self._wiring.unregister_all()
        except Exception:
            pass
        if self._db_path:
            for store in self._room_stores:
                try:
                    await store.close()
                except Exception:
                    pass
            try:
                await self._event_store.close()
            except Exception:
                pass
        if self._conn_manager is not None:
            try:
                await self._conn_manager.close()
            except Exception:
                pass

    async def _scheduled_backup(self) -> None:
        import os as _os
        from cabinet.core.backup import BackupManager

        data_dir = _os.path.dirname(_os.path.dirname(self._db_path))
        manager = BackupManager(data_dir)
        try:
            while True:
                await asyncio.sleep(3600)
                try:
                    await manager.create_backup(label="auto")
                    logger.info("Scheduled backup completed")
                except Exception as e:
                    logger.error("Scheduled backup failed: %s", e)
        except asyncio.CancelledError:
            pass

    async def _discover_mcp_tools(self) -> None:
        if self._mcp_connector is None:
            return
        for server_name in await self._mcp_connector.list_connected_servers():
            skills = await self._mcp_connector.discover_tools(server_name)
            for skill in skills:
                await self._tool_registry.register(skill)
                self._tool_registry._mcp_skill_names.add(skill.name)

    async def stop(self) -> None:
        logger.info("CabinetRuntime stopping")
        if self._audit_store is not None:
            await self._audit_store.log(AuditEvent(
                action="runtime.stop", actor="system", resource_type="runtime", resource_id="cabinet",
            ))
        if self._backup_task is not None:
            self._backup_task.cancel()
            try:
                await self._backup_task
            except asyncio.CancelledError:
                pass
            self._backup_task = None
        await self._wiring.unregister_all()
        if self._dead_letter_queue is not None:
            await self._dead_letter_queue.close()
            self._dead_letter_queue = None
        if self._mcp_connector is not None:
            await self._mcp_connector.disconnect_all()
        if self._memory_store is not None:
            await self._memory_store.close()
        if self._db_path:
            for store in self._room_stores:
                await store.close()
            await self._event_store.close()
        if self._audit_store is not None:
            await self._audit_store.close()
        if self._conn_manager is not None:
            await self._conn_manager.close()
            self._conn_manager = None
        logger.info("CabinetRuntime stopped")

    async def health_check(self) -> dict:
        import asyncio as _asyncio

        components: list[dict] = []

        async def _check(name: str, coro) -> dict:
            start = _time.monotonic()
            try:
                result = await _asyncio.wait_for(coro, timeout=5.0)
                latency = (_time.monotonic() - start) * 1000
                return {
                    "name": name,
                    "status": result.get("status", "healthy"),
                    "detail": result.get("detail", ""),
                    "latency_ms": round(latency, 2),
                }
            except Exception as e:
                latency = (_time.monotonic() - start) * 1000
                return {
                    "name": name,
                    "status": "unhealthy",
                    "detail": str(e),
                    "latency_ms": round(latency, 2),
                }

        checks = []
        checks.append(_check("sqlite_event_store", self._check_sqlite()))
        if self._memory_store is not None:
            checks.append(_check("chromadb_memory", self._check_chromadb_memory()))
        if self._knowledge_base is not None:
            checks.append(_check("chromadb_knowledge", self._check_chromadb_knowledge()))
        if self._gateway is not None:
            checks.append(_check("llm_gateway", self._check_gateway()))
        if self._mcp_connector is not None:
            checks.append(_check("mcp_connector", self._check_mcp()))
        checks.append(_check("eventbus", self._check_eventbus()))

        components = await _asyncio.gather(*checks)

        overall = "healthy"
        for c in components:
            if c["status"] == "unhealthy":
                overall = "unhealthy"
                break
            if c["status"] == "degraded" and overall == "healthy":
                overall = "degraded"

        return {
            "status": overall,
            "version": __version__,
            "components": components,
            "uptime_seconds": _time.monotonic() - self._start_time,
        }

    async def _check_sqlite(self) -> dict:
        try:
            if self._db_path and hasattr(self._event_store, "_db") and self._event_store._db:
                await self._event_store._db.execute("SELECT 1")
            return {"status": "healthy"}
        except Exception as e:
            return {"status": "unhealthy", "detail": str(e)}

    async def _check_chromadb_memory(self) -> dict:
        try:
            count = self._memory_store._collection.count()
            return {"status": "healthy", "detail": f"count={count}"}
        except Exception as e:
            return {"status": "degraded", "detail": str(e)}

    async def _check_chromadb_knowledge(self) -> dict:
        try:
            count = self._knowledge_base._collection.count()
            return {"status": "healthy", "detail": f"count={count}"}
        except Exception as e:
            return {"status": "degraded", "detail": str(e)}

    async def _check_gateway(self) -> dict:
        if self._gateway is None:
            return {"status": "degraded", "detail": "no gateway configured"}
        if hasattr(self._gateway, "list_models"):
            models = self._gateway.list_models()
            if not models:
                return {"status": "degraded", "detail": "no models configured"}
            return {"status": "healthy", "detail": f"models={len(models)}"}
        return {"status": "healthy", "detail": "gateway configured"}

    async def _check_mcp(self) -> dict:
        try:
            servers = await self._mcp_connector.list_connected_servers()
            return {"status": "healthy", "detail": f"servers={len(servers)}"}
        except Exception as e:
            return {"status": "healthy", "detail": str(e)}

    async def _check_eventbus(self) -> dict:
        handler_count = sum(len(v) for v in self._bus._handlers.values())
        if handler_count > 0:
            return {"status": "healthy", "detail": f"handlers={handler_count}"}
        return {"status": "unhealthy", "detail": "no handlers registered"}

    async def preflight_check(self) -> dict[str, str]:
        checks = {}
        checks["llm"] = await self._check_llm_reachable()
        checks["chromadb"] = await self._check_chromadb_writable()
        checks["api_keys"] = self._check_api_keys_valid()
        return checks

    async def _check_llm_reachable(self) -> str:
        if self._gateway is None:
            return "not_configured"
        if hasattr(self._gateway, "list_models"):
            models = self._gateway.list_models()
            if not models:
                return "no_models"
        return "ok"

    async def _check_chromadb_writable(self) -> str:
        if self._memory_store is None:
            return "not_configured"
        try:
            if hasattr(self._memory_store, "_collection"):
                count = self._memory_store._collection.count()
                return f"ok(count={count})"
            return "ok"
        except Exception as e:
            return f"error:{e}"

    def _check_api_keys_valid(self) -> str:
        if not self._api_keys:
            return "no_keys"
        empty_keys = [k for k, v in self._api_keys.items() if not v]
        if empty_keys:
            return f"empty_keys:{','.join(empty_keys)}"
        return "ok"

    @property
    def bus(self) -> AsyncIOEventBus:
        return self._bus

    @property
    def wiring(self) -> RoomEventWiring:
        return self._wiring

    @property
    def evaluator(self) -> DefaultEvaluator:
        return self._evaluator

    @property
    def verification_gate(self) -> WorkflowVerificationGate:
        return self._verification_gate

    @property
    def escalation_protocol(self) -> DefaultEscalationProtocol:
        return self._escalation_protocol

    @property
    def workflow_engine(self) -> WorkflowEngine:
        return self._workflow_engine

    @property
    def meeting(self) -> MeetingRoomService:
        return self._meeting

    @property
    def strategy(self) -> StrategyDecoderService:
        return self._strategy

    @property
    def decision(self) -> DecisionRoomService:
        return self._decision

    @property
    def office(self) -> OfficeSchedulerService:
        return self._office

    @property
    def summary(self) -> SummaryRoomService:
        return self._summary

    @property
    def secretary(self) -> SecretaryAgentService:
        return self._secretary

    @property
    def store(self):
        return self._bus._store

    @property
    def tool_registry(self) -> LocalToolRegistry:
        return self._tool_registry

    @property
    def employee_store(self):
        return self._employee_store

    @property
    def gateway(self):
        return self._gateway

    @property
    def knowledge_base(self):
        return self._knowledge_base

    @property
    def mailbox_router(self) -> MailboxRouter:
        return self._mailbox_router

    @property
    def handoff_manager(self) -> HandoffManager:
        return self._handoff_manager

    @property
    def agent_pool(self) -> AgentPool:
        return self._agent_pool

    @property
    def capability_registry(self) -> CapabilityRegistry:
        return self._capability_registry

    @property
    def tool_registry_adapter(self) -> ToolRegistryAdapter:
        return self._tool_registry_adapter

    def _create_default_employee_store(self):
        from cabinet.agents.employee_store import JsonEmployeeStore
        import tempfile
        import os
        tmp = tempfile.mkdtemp()
        return JsonEmployeeStore(path=os.path.join(tmp, "employees.json"))
