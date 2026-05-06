import uuid


from cabinet.agents.context import AgentContext, AgentOutput, SkillContext, SkillOutput, TeamOutput
from cabinet.agents.protocol import AgentFactory


def test_agent_context_creation():
    ctx = AgentContext(model="default")
    assert ctx.model == "default"
    assert ctx.temperature == 0.7


def test_agent_output_creation():
    emp_id = uuid.uuid4()
    output = AgentOutput(content="Task completed", employee_id=emp_id)
    assert output.content == "Task completed"
    assert output.employee_id == emp_id


def test_skill_context_creation():
    ctx = SkillContext()
    assert ctx.model == "default"


def test_skill_output_creation():
    skill_id = uuid.uuid4()
    output = SkillOutput(content="Skill result", skill_id=skill_id)
    assert output.content == "Skill result"


def test_team_output_creation():
    team_id = uuid.uuid4()
    output = TeamOutput(content="Team result", team_id=team_id)
    assert output.team_id == team_id


def test_agent_factory_is_runtime_checkable():
    class FakeFactory:
        async def create_agent(self, agent_id, role):
            pass
        async def create_team(self, agents, task):
            pass

    assert isinstance(FakeFactory(), AgentFactory)


def test_agent_output_enhanced_fields():
    emp_id = uuid.uuid4()
    output = AgentOutput(content="Task completed", employee_id=emp_id)
    assert output.status == "completed"
    assert output.structured_data is None
    assert output.artifacts == []
    assert output.token_usage is None
    assert output.duration_ms is None


def test_agent_output_with_structured_data():
    emp_id = uuid.uuid4()
    output = AgentOutput(
        content="result", employee_id=emp_id,
        status="completed",
        structured_data={"key": "value"},
        token_usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        duration_ms=150.5,
    )
    assert output.structured_data == {"key": "value"}
    assert output.token_usage["total_tokens"] == 30
    assert output.duration_ms == 150.5


def test_agent_output_backward_compatible():
    emp_id = uuid.uuid4()
    output = AgentOutput(content="hello", employee_id=emp_id)
    assert output.content == "hello"
    assert output.employee_id == emp_id
    assert output.status == "completed"
