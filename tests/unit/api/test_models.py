import pytest

from cabinet.api.models import (
    ChatRequest,
    ChatResponse,
    EmployeeCreate,
    EmployeeResponse,
    SkillRunRequest,
    KnowledgeQueryRequest,
    MeetingRequest,
    DecisionRequest,
    TaskRequest,
    ReviewRequest,
    ErrorResponse,
)


def test_chat_request_defaults():
    req = ChatRequest(message="hello")
    assert req.captain_id == "captain"


def test_chat_response():
    resp = ChatResponse(response="hi", captain_id="cap1")
    assert resp.response == "hi"


def test_employee_create_defaults():
    req = EmployeeCreate(name="Advisor", role="advisor")
    assert req.personality == ""
    assert req.kind == "ai"


def test_employee_response():
    resp = EmployeeResponse(id="abc", name="A", role="advisor", kind="ai", skills=[])
    assert resp.skills == []


def test_skill_run_request_defaults():
    req = SkillRunRequest()
    assert req.inputs == {}


def test_knowledge_query_defaults():
    req = KnowledgeQueryRequest(question="test")
    assert req.top_k == 3


def test_meeting_request_defaults():
    req = MeetingRequest(topic="growth")
    assert req.level == "multi_party"


def test_decision_request_defaults():
    req = DecisionRequest(title="hire")
    assert req.decision_type == "strategic"
    assert req.options == []


def test_task_request_defaults():
    req = TaskRequest(description="build API")
    assert req.inputs == {}


def test_review_request_defaults():
    req = ReviewRequest()
    assert req.project_id is None
    assert req.review_type == "project_review"


def test_error_response():
    resp = ErrorResponse(error="Not found", detail="missing")
    assert resp.error == "Not found"


def test_knowledge_query_request_top_k_upper_bound():
    from cabinet.api.models import KnowledgeQueryRequest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        KnowledgeQueryRequest(question="test", top_k=100)

    valid = KnowledgeQueryRequest(question="test", top_k=50)
    assert valid.top_k == 50

    valid_min = KnowledgeQueryRequest(question="test", top_k=1)
    assert valid_min.top_k == 1
