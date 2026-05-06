import uuid

from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)


def test_action_domain_creation():
    domain = ActionDomain(
        name="Market Expansion",
        goal="Enter European market",
        constraints=["Budget under 50k", "No external hires"],
        success_criteria=["First sale completed", "Local partnership signed"],
        dependencies=["Legal Review"],
        risk_checkpoints=["Regulatory approval pending"],
    )
    assert domain.name == "Market Expansion"
    assert domain.goal == "Enter European market"
    assert len(domain.constraints) == 2
    assert len(domain.success_criteria) == 2
    assert domain.dependencies == ["Legal Review"]


def test_action_domain_defaults():
    domain = ActionDomain(name="Ops", goal="Improve efficiency")
    assert domain.constraints == []
    assert domain.success_criteria == []
    assert domain.dependencies == []
    assert domain.risk_checkpoints == []


def test_action_blueprint_creation():
    proj_id = uuid.uuid4()
    proposal_id = uuid.uuid4()
    domain = ActionDomain(name="Sales", goal="Increase revenue")
    blueprint = ActionBlueprint(
        project_id=proj_id,
        source_proposal_id=proposal_id,
        domains=[domain],
        execution_order=[["Sales"]],
        global_constraints=["No budget overrun"],
    )
    assert blueprint.project_id == proj_id
    assert len(blueprint.domains) == 1
    assert blueprint.execution_order == [["Sales"]]
    assert blueprint.global_constraints == ["No budget overrun"]


def test_action_blueprint_execution_order():
    proj_id = uuid.uuid4()
    proposal_id = uuid.uuid4()
    blueprint = ActionBlueprint(
        project_id=proj_id,
        source_proposal_id=proposal_id,
        domains=[],
        execution_order=[["Legal", "Finance"], ["Operations"]],
    )
    assert len(blueprint.execution_order) == 2
    assert len(blueprint.execution_order[0]) == 2
    assert blueprint.execution_order[1] == ["Operations"]


def test_blueprint_validation_valid():
    validation = BlueprintValidation(
        valid=True,
        domain_count_ok=True,
        dependencies_resolved=True,
        criteria_measurable=True,
    )
    assert validation.valid is True
    assert validation.issues == []
    assert validation.domain_count_ok is True


def test_blueprint_validation_invalid():
    validation = BlueprintValidation(
        valid=False,
        issues=["Too many domains", "Circular dependency detected"],
        domain_count_ok=False,
        dependencies_resolved=False,
        criteria_measurable=True,
    )
    assert validation.valid is False
    assert len(validation.issues) == 2
    assert validation.domain_count_ok is False


def test_decode_context():
    ctx = DecodeContext(
        project_id=uuid.uuid4(),
        captain_id="captain-1",
        existing_constraints=["Must comply with GDPR"],
    )
    assert ctx.captain_id == "captain-1"
    assert len(ctx.existing_constraints) == 1


def test_decode_context_defaults():
    ctx = DecodeContext(
        project_id=uuid.uuid4(),
        captain_id="captain-1",
    )
    assert ctx.existing_constraints == []
