import uuid

from cabinet.models.primitives import (
    Employee,
    Knowledge,
    MemoryItem,
    MemoryScope,
    Organization,
    Project,
    SkillDefinition,
    Team,
)


def test_organization_creation():
    org = Organization(
        name="TestOrg",
        captain_id="captain-1",
    )
    assert org.name == "TestOrg"
    assert org.captain_id == "captain-1"
    assert org.projects == []
    assert org.id is not None
    assert org.created_at is not None


def test_project_creation():
    proj = Project(
        organization_id=uuid.uuid4(),
        name="TestProject",
        description="A test project",
    )
    assert proj.name == "TestProject"
    assert proj.status == "active"
    assert proj.teams == []


def test_team_creation():
    team = Team(
        project_id=uuid.uuid4(),
        name="Core Team",
        purpose="Build the foundation",
    )
    assert team.name == "Core Team"
    assert team.employees == []


def test_employee_creation():
    emp = Employee(
        team_id=uuid.uuid4(),
        name="Alice",
        role="Analyst",
        kind="ai",
        personality="Analytical and precise",
    )
    assert emp.name == "Alice"
    assert emp.kind == "ai"
    assert emp.permission_level == "L2"
    assert emp.skills == []


def test_employee_human():
    emp = Employee(
        team_id=uuid.uuid4(),
        name="Bob",
        role="Consultant",
        kind="human",
    )
    assert emp.kind == "human"


def test_skill_definition_atomic():
    skill = SkillDefinition(
        name="resume_parser",
        description="Parses resumes into structured data",
        kind="atomic",
        input_schema={"type": "object", "properties": {"resume_text": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"parsed": {"type": "object"}}},
        prompt_template="Parse the following resume: {resume_text}",
    )
    assert skill.kind == "atomic"
    assert skill.requires_human_approval is False
    assert skill.sub_workflow is None


def test_skill_definition_composite():
    skill = SkillDefinition(
        name="code_review",
        description="Full code review pipeline",
        kind="composite",
        input_schema={"type": "object", "properties": {"code": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"report": {"type": "object"}}},
        sub_workflow=uuid.uuid4(),
    )
    assert skill.kind == "composite"
    assert skill.sub_workflow is not None


def test_knowledge_creation():
    kb = Knowledge(
        name="HR Policies",
        description="Company HR policy documents",
        source_paths=["/data/knowledge/hr/"],
    )
    assert kb.name == "HR Policies"
    assert kb.indexed_at is None


def test_memory_item_creation():
    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.SHORT_TERM,
        content="Previous discussion about pricing strategy",
    )
    assert item.scope == MemoryScope.SHORT_TERM
    assert item.embedding is None


def test_employee_with_pipe_and_persona():
    pipe_id = uuid.uuid4()
    persona_id = uuid.uuid4()
    emp = Employee(
        team_id=uuid.uuid4(),
        name="财务小王",
        role="财务分析师",
        kind="ai",
        pipe_id=pipe_id,
        persona_id=persona_id,
    )
    assert emp.pipe_id == pipe_id
    assert emp.persona_id == persona_id
    assert emp.pipe_params == {}


def test_employee_without_pipe_backward_compatible():
    emp = Employee(
        team_id=uuid.uuid4(),
        name="Bob",
        role="Consultant",
        kind="human",
    )
    assert emp.pipe_id is None
    assert emp.persona_id is None
    assert emp.pipe_params == {}


def test_employee_pipe_params_override():
    emp = Employee(
        team_id=uuid.uuid4(),
        name="分析师",
        role="Analyst",
        kind="ai",
        pipe_id=uuid.uuid4(),
        pipe_params={"temperature": 0.1, "max_tokens": 1000},
    )
    assert emp.pipe_params["temperature"] == 0.1
    assert emp.pipe_params["max_tokens"] == 1000
