from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from cabinet.agents.context import AgentContext, AgentOutput, SkillContext, SkillOutput, TeamContext, TeamOutput


def test_agent_context_defaults():
    ctx = AgentContext()
    assert ctx.model == "default"
    assert ctx.temperature == 0.7
    assert ctx.max_tokens is None


def test_agent_context_custom():
    ctx = AgentContext(model="gpt-4", temperature=0.3, max_tokens=1000)
    assert ctx.model == "gpt-4"
    assert ctx.temperature == 0.3
    assert ctx.max_tokens == 1000


def test_agent_output_required_fields():
    emp_id = uuid4()
    out = AgentOutput(content="hello", employee_id=emp_id)
    assert out.content == "hello"
    assert out.employee_id == emp_id
    assert out.status == "completed"
    assert out.structured_data is None
    assert out.artifacts == []
    assert out.token_usage is None
    assert out.duration_ms is None


def test_agent_output_missing_content():
    with pytest.raises(ValidationError):
        AgentOutput(employee_id=uuid4())


def test_skill_context_defaults():
    ctx = SkillContext()
    assert ctx.model == "default"
    assert ctx.temperature == 0.7


def test_skill_output_required_fields():
    skill_id = uuid4()
    out = SkillOutput(content="result", skill_id=skill_id)
    assert out.content == "result"
    assert out.skill_id == skill_id


def test_team_context_defaults():
    ctx = TeamContext()
    assert ctx.model == "default"


def test_team_output_required_fields():
    team_id = uuid4()
    out = TeamOutput(content="team result", team_id=team_id)
    assert out.content == "team result"
    assert out.team_id == team_id


def test_agent_output_serialization():
    emp_id = uuid4()
    out = AgentOutput(content="test", employee_id=emp_id, token_usage={"prompt": 10})
    data = out.model_dump()
    assert data["content"] == "test"
    assert data["token_usage"] == {"prompt": 10}
    restored = AgentOutput.model_validate(data)
    assert restored.content == "test"
