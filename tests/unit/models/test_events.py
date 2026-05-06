import uuid

from cabinet.models.events import (
    DeliberationDissent,
    DeliberationProposal,
    DecisionRequest,
    DecisionResponse,
    HarnessEvaluationResult,
    MessageEnvelope,
    MessageType,
    SecretaryNotification,
    StrategyDecodeResult,
    SummaryInsight,
    SummaryReviewRequest,
    TaskFailure,
    TaskOrder,
    TaskStatusUpdate,
)


def test_message_envelope_creation():
    env = MessageEnvelope(
        sender="room:meeting-room",
        recipients=["hub:decision-hub"],
        message_type="deliberation.proposal",
        payload={"key": "value"},
    )
    assert env.message_id is not None
    assert env.correlation_id is not None
    assert env.causation_id is not None
    assert env.sender == "room:meeting-room"
    assert env.status == "active"
    assert env.payload == {"key": "value"}


def test_message_type_values():
    assert MessageType.DELIBERATION_PROPOSAL.value == "deliberation.proposal"
    assert MessageType.DELIBERATION_DISSENT.value == "deliberation.dissent"
    assert MessageType.STRATEGY_DECODE_RESULT.value == "strategy.decode_result"
    assert MessageType.DECISION_REQUEST.value == "decision.request"
    assert MessageType.DECISION_RESPONSE.value == "decision.response"
    assert MessageType.TASK_ORDER.value == "task.order"
    assert MessageType.TASK_STATUS_UPDATE.value == "task.status_update"
    assert MessageType.TASK_FAILURE.value == "task.failure"
    assert MessageType.SUMMARY_INSIGHT.value == "summary.insight"
    assert MessageType.SUMMARY_REVIEW_REQUEST.value == "summary.review_request"
    assert MessageType.HARNESS_EVALUATION_RESULT.value == "harness.evaluation_result"


def test_deliberation_proposal():
    msg = DeliberationProposal(
        proposal_text="Expand into EU market",
        confidence=0.85,
        reasoning_summary="Strong demand signals",
    )
    assert msg.proposal_text == "Expand into EU market"
    assert msg.confidence == 0.85


def test_deliberation_dissent():
    msg = DeliberationDissent(
        dissent_text="Risk of regulatory compliance",
        source_agent_id=uuid.uuid4(),
    )
    assert msg.dissent_text == "Risk of regulatory compliance"


def test_strategy_decode_result():
    msg = StrategyDecodeResult(
        action_domains=["Market Entry", "Legal Setup"],
        constraints=["Budget under 50k"],
        success_criteria=["First EU client signed"],
    )
    assert len(msg.action_domains) == 2


def test_decision_request():
    msg = DecisionRequest(
        decision_id=uuid.uuid4(),
        decision_type="strategic",
        title="Enter EU market",
        options=[{"label": "Go"}, {"label": "Wait"}],
    )
    assert msg.decision_type == "strategic"
    assert len(msg.options) == 2


def test_decision_response():
    msg = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"label": "Go"},
        captain_id="captain-1",
    )
    assert msg.chosen_option["label"] == "Go"


def test_task_order():
    msg = TaskOrder(
        employee_id=uuid.uuid4(),
        skill_id=uuid.uuid4(),
        inputs={"action": "analyze"},
    )
    assert msg.inputs["action"] == "analyze"


def test_task_status_update():
    msg = TaskStatusUpdate(
        task_id=uuid.uuid4(),
        status="in_progress",
        progress=0.5,
    )
    assert msg.status == "in_progress"


def test_task_failure():
    msg = TaskFailure(
        task_id=uuid.uuid4(),
        error_message="API timeout",
        retry_count=3,
    )
    assert msg.retry_count == 3


def test_summary_insight():
    msg = SummaryInsight(
        insight_type="optimization",
        content="Workflow bottleneck in review step",
    )
    assert msg.insight_type == "optimization"


def test_summary_review_request():
    msg = SummaryReviewRequest(
        project_id=uuid.uuid4(),
        review_type="project_retrospective",
    )
    assert msg.review_type == "project_retrospective"


def test_harness_evaluation_result():
    msg = HarnessEvaluationResult(
        passed=True,
        evaluator_id=uuid.uuid4(),
        notes="All criteria met",
    )
    assert msg.passed is True


def test_secretary_notification_message_type():
    assert MessageType.SECRETARY_NOTIFICATION.value == "secretary.notification"


def test_secretary_notification_payload():
    notification = SecretaryNotification(
        captain_id="captain-1",
        notification_type="decision_made",
        content="A decision has been approved",
        severity="info",
    )
    assert notification.captain_id == "captain-1"
    assert notification.severity == "info"
    assert notification.related_decision_id is None


def test_secretary_notification_with_decision_id():
    decision_id = uuid.uuid4()
    notification = SecretaryNotification(
        captain_id="captain-1",
        notification_type="urgent_decision",
        content="Urgent decision requires attention",
        severity="critical",
        related_decision_id=decision_id,
    )
    assert notification.related_decision_id == decision_id
