import asyncio
import tempfile
import uuid

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.models.events import (
    DecisionResponse,
    DeliberationProposal,
    MessageEnvelope,
    TaskFailure,
    TaskOrder,
)
from cabinet.models.primitives import MemoryItem, MemoryScope, SkillDefinition
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.summary.event_handler import SummaryEventHandler


@pytest.mark.asyncio
async def test_event_bus_to_memory_flow():
    bus = AsyncIOEventBus()
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = f"{tmpdir}/test.db"
        from cabinet.core.events.migrations import MigrationRunner
        from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()
        store = SQLiteMemoryStore(db_path=db_path)
        await store.initialize()

        decision_id = uuid.uuid4()
        env = MessageEnvelope(
            sender="hub:decision-hub",
            recipients=["room:office"],
            message_type="decision.response",
            payload={"decision_id": str(decision_id), "chosen_option": "Go"},
        )

        stored_items = []

        async def handler(envelope: MessageEnvelope):
            item = MemoryItem(
                owner_id=uuid.UUID(envelope.payload["decision_id"]) if "decision_id" in envelope.payload else uuid.uuid4(),
                scope=MemoryScope.SHORT_TERM,
                content=str(envelope.payload),
            )
            await store.store(f"decision-{envelope.message_id}", item, MemoryScope.SHORT_TERM)
            stored_items.append(item)

        await bus.subscribe("decision.response", handler)
        await bus.publish(env)
        await asyncio.sleep(0.05)

        assert len(stored_items) == 1
        result = await store.retrieve(f"decision-{env.message_id}", MemoryScope.SHORT_TERM)
        assert result is not None
        assert "Go" in result.content

        await store.close()


@pytest.mark.asyncio
async def test_skill_registration_and_execution():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        name="test_skill",
        description="A test skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)
    output = await registry.execute("test_skill", {"key": "value"})
    assert output.skill_id == skill.id

    found = await registry.get_skill(skill.id)
    assert found.name == "test_skill"


@pytest.mark.asyncio
async def test_causation_chain_across_rooms():
    bus = AsyncIOEventBus()

    env1 = MessageEnvelope(
        sender="room:meeting-room",
        recipients=["hub:decision-hub"],
        message_type="deliberation.proposal",
        payload={"proposal": "expand"},
    )
    await bus.publish(env1)

    env2 = MessageEnvelope(
        sender="hub:decision-hub",
        recipients=["room:office"],
        message_type="decision.response",
        payload={"chosen": "approve"},
        causation_id=env1.message_id,
    )
    await bus.publish(env2)

    env3 = MessageEnvelope(
        sender="room:office",
        recipients=["room:office"],
        message_type="task.order",
        payload={"task": "research"},
        causation_id=env2.message_id,
    )
    await bus.publish(env3)

    chain = await bus.get_causation_chain(env3.message_id)
    assert len(chain) == 3
    assert chain[0].message_type == "deliberation.proposal"
    assert chain[1].message_type == "decision.response"
    assert chain[2].message_type == "task.order"


@pytest.mark.asyncio
async def test_full_decision_pipeline():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    decision_submits = []
    office_tasks = []

    class FakeDecisionRoom:
        async def submit(self, request):
            decision_submits.append(request)

        async def cascade(self, decision):
            pass

    class FakeOfficeRoom:
        async def submit_task(self, order):
            office_tasks.append(order)

    await wiring.register(MeetingEventHandler())
    await wiring.register(DecisionEventHandler(FakeDecisionRoom()))
    await wiring.register(OfficeEventHandler(FakeOfficeRoom()))

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    await wiring.publish("meeting", "deliberation.proposal", proposal)

    await asyncio.sleep(0.05)

    assert len(decision_submits) == 1
    assert decision_submits[0].title == "expand market"


@pytest.mark.asyncio
async def test_decision_to_office_pipeline():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    office_tasks = []

    class FakeOfficeRoom:
        async def submit_task(self, order):
            office_tasks.append(order)

    await wiring.register(OfficeEventHandler(FakeOfficeRoom()))

    order = TaskOrder(
        employee_id=uuid.uuid4(),
        skill_id=uuid.uuid4(),
        inputs={"action": "research"},
    )
    await wiring.publish("decision", "task.order", order)

    await asyncio.sleep(0.05)

    assert len(office_tasks) == 1


@pytest.mark.asyncio
async def test_task_failure_triggers_cascade():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    cascaded = []

    class FakeDecisionRoom:
        async def submit(self, request):
            pass

        async def cascade(self, decision):
            cascaded.append(decision)

    await wiring.register(DecisionEventHandler(FakeDecisionRoom()))

    failure = TaskFailure(
        task_id=uuid.uuid4(),
        error_message="API timeout",
        retry_count=3,
    )
    await wiring.publish("office", "task.failure", failure)

    await asyncio.sleep(0.05)

    assert len(cascaded) == 1
    assert cascaded[0].decision_type.value == "anomaly"


@pytest.mark.asyncio
async def test_secretary_notification_on_decision():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    notifications = []

    class FakeSecretaryRoom:
        async def notify(self, event):
            notifications.append(event)

    await wiring.register(SecretaryEventHandler(FakeSecretaryRoom()))

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    await wiring.publish("decision", "decision.response", response)

    await asyncio.sleep(0.05)

    assert len(notifications) == 1
    assert notifications[0].event_type == "decision_made"


@pytest.mark.asyncio
async def test_causation_chain_across_rooms_with_wiring():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    await wiring.register(MeetingEventHandler())

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    await wiring.publish("meeting", "deliberation.proposal", proposal)
    proposal_envelope = bus._store.get_by_type("deliberation.proposal")[0]

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    await wiring.publish("decision", "decision.response", response, causation_id=proposal_envelope.message_id)
    response_envelope = bus._store.get_by_type("decision.response")[0]

    chain = await bus.get_causation_chain(response_envelope.message_id)
    assert len(chain) == 2
    assert chain[0].message_type == "deliberation.proposal"
    assert chain[1].message_type == "decision.response"


@pytest.mark.asyncio
async def test_resolve_recipients_across_all_rooms():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    class FakeDecisionRoom:
        async def submit(self, request): pass
        async def cascade(self, decision): pass

    class FakeOfficeRoom:
        async def submit_task(self, order): pass

    class FakeSummaryRoom:
        async def start_review(self, project_id, review_type): pass
        async def generate_insights(self, session_id): pass

    class FakeSecretaryRoom:
        async def notify(self, event): pass

    await wiring.register(MeetingEventHandler())
    await wiring.register(DecisionEventHandler(FakeDecisionRoom()))
    await wiring.register(OfficeEventHandler(FakeOfficeRoom()))
    await wiring.register(SummaryEventHandler(FakeSummaryRoom()))
    await wiring.register(SecretaryEventHandler(FakeSecretaryRoom()))

    recipients = wiring.resolve_recipients("deliberation.proposal")
    assert "room:decision" in recipients

    recipients = wiring.resolve_recipients("decision.response")
    assert "room:office" in recipients
    assert "room:summary" in recipients
    assert "room:secretary" in recipients

    recipients = wiring.resolve_recipients("task.order")
    assert "room:office" in recipients

    recipients = wiring.resolve_recipients("task.failure")
    assert "room:decision" in recipients

    recipients = wiring.resolve_recipients("summary.insight")
    assert "room:secretary" in recipients
