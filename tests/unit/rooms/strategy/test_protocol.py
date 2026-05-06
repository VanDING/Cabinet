import uuid

import pytest

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
)
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)
from cabinet.rooms.strategy.protocol import StrategyDecoder


def test_strategy_decoder_protocol_runtime_checkable():
    class MockDecoder:
        async def decode(self, proposal, context):
            return ActionBlueprint(
                project_id=context.project_id,
                source_proposal_id=proposal.session_id,
                domains=[ActionDomain(name="Test", goal="Test goal")],
                execution_order=[["Test"]],
            )

        async def validate_blueprint(self, blueprint):
            return BlueprintValidation(
                valid=True,
                domain_count_ok=True,
                dependencies_resolved=True,
                criteria_measurable=True,
            )

    mock = MockDecoder()
    assert isinstance(mock, StrategyDecoder)


@pytest.mark.asyncio
async def test_strategy_decoder_decode_contract():
    class MockDecoder:
        async def decode(self, proposal, context):
            return ActionBlueprint(
                project_id=context.project_id,
                source_proposal_id=proposal.session_id,
                domains=[ActionDomain(name="Sales", goal="Increase revenue")],
                execution_order=[["Sales"]],
            )

        async def validate_blueprint(self, blueprint):
            return BlueprintValidation(
                valid=True,
                domain_count_ok=True,
                dependencies_resolved=True,
                criteria_measurable=True,
            )

    decoder = MockDecoder()
    session_id = uuid.uuid4()
    convergence = ConvergenceResult(consensus="Go", dissent=[], unresolved=[])
    proposal = DeliberationResult(
        session_id=session_id,
        proposal_text="Expand market",
        confidence=0.8,
        reasoning_summary="Strong signals",
        convergence=convergence,
        rounds_used=1,
        rumination_detected=False,
    )
    output = DeliberationOutput(session_id=session_id, proposal=proposal)
    ctx = DecodeContext(project_id=uuid.uuid4(), captain_id="captain-1")
    blueprint = await decoder.decode(output, ctx)
    assert isinstance(blueprint, ActionBlueprint)
    assert len(blueprint.domains) == 1


@pytest.mark.asyncio
async def test_strategy_decoder_validate_contract():
    class MockDecoder:
        async def decode(self, proposal, context):
            return ActionBlueprint(
                project_id=context.project_id,
                source_proposal_id=proposal.session_id,
                domains=[],
                execution_order=[],
            )

        async def validate_blueprint(self, blueprint):
            return BlueprintValidation(
                valid=len(blueprint.domains) <= 5,
                domain_count_ok=len(blueprint.domains) <= 5,
                dependencies_resolved=True,
                criteria_measurable=True,
                issues=[] if len(blueprint.domains) <= 5 else ["Too many domains"],
            )

    decoder = MockDecoder()
    proj_id = uuid.uuid4()
    blueprint = ActionBlueprint(
        project_id=proj_id,
        source_proposal_id=uuid.uuid4(),
        domains=[ActionDomain(name=f"D{i}", goal=f"G{i}") for i in range(6)],
        execution_order=[],
    )
    validation = await decoder.validate_blueprint(blueprint)
    assert isinstance(validation, BlueprintValidation)
    assert validation.valid is False
    assert validation.domain_count_ok is False
