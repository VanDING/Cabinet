import uuid

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    DissentItem,
    MeetingLevel,
    Perspective,
)


def test_meeting_level_values():
    assert MeetingLevel.FREE_DRAFT == "free_draft"
    assert MeetingLevel.MULTI_PARTY == "multi_party"
    assert MeetingLevel.EXPERT_HEARING == "expert_hearing"


def test_deliberation_session_creation():
    proj_id = uuid.uuid4()
    participant = uuid.uuid4()
    session = DeliberationSession(
        project_id=proj_id,
        topic="Should we expand to new market?",
        level=MeetingLevel.MULTI_PARTY,
        participants=[participant],
    )
    assert session.topic == "Should we expand to new market?"
    assert session.level == MeetingLevel.MULTI_PARTY
    assert session.status == "open"
    assert session.round == 1
    assert session.experts == []


def test_perspective_creation():
    session_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    perspective = Perspective(
        session_id=session_id,
        agent_id=agent_id,
        content="I believe we should expand gradually",
        round=1,
    )
    assert perspective.content == "I believe we should expand gradually"
    assert perspective.round == 1


def test_dissent_item():
    agent_id = uuid.uuid4()
    dissent = DissentItem(
        agent_id=agent_id,
        content="I disagree with the timeline",
        reasoning="The proposed timeline doesn't account for regulatory approval",
    )
    assert dissent.agent_id == agent_id
    assert dissent.reasoning == "The proposed timeline doesn't account for regulatory approval"


def test_convergence_result():
    agent_id = uuid.uuid4()
    result = ConvergenceResult(
        consensus="Expand to new market with phased approach",
        dissent=[DissentItem(agent_id=agent_id, content="Timeline too aggressive", reasoning="Regulatory delays")],
        unresolved=["Budget allocation for Q3"],
    )
    assert result.consensus == "Expand to new market with phased approach"
    assert len(result.dissent) == 1
    assert len(result.unresolved) == 1


def test_deliberation_result():
    session_id = uuid.uuid4()
    convergence = ConvergenceResult(
        consensus="Agreed",
        dissent=[],
        unresolved=[],
    )
    result = DeliberationResult(
        session_id=session_id,
        proposal_text="Expand to European market in Q3",
        confidence=0.85,
        reasoning_summary="Strong market signals with manageable risk",
        convergence=convergence,
        rounds_used=2,
        rumination_detected=False,
    )
    assert result.confidence == 0.85
    assert result.rounds_used == 2
    assert result.rumination_detected is False


def test_deliberation_output():
    session_id = uuid.uuid4()
    convergence = ConvergenceResult(consensus="Go", dissent=[], unresolved=[])
    proposal = DeliberationResult(
        session_id=session_id,
        proposal_text="Test proposal",
        confidence=0.9,
        reasoning_summary="Test",
        convergence=convergence,
        rounds_used=1,
        rumination_detected=False,
    )
    output = DeliberationOutput(
        session_id=session_id,
        proposal=proposal,
    )
    assert output.session_id == session_id
    assert output.proposal.proposal_text == "Test proposal"
    assert output.event_payload is not None
