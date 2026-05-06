from uuid import uuid4

from cabinet.rooms.strategy.domain_events import BlueprintDecoded, BlueprintValidated


def test_blueprint_decoded_creation():
    event = BlueprintDecoded(
        blueprint_id=uuid4(),
        proposal_session_id=uuid4(),
        action_domains=["marketing"],
        constraints=["budget"],
        success_criteria=["revenue up"],
    )
    assert event.action_domains == ["marketing"]
    assert event.constraints == ["budget"]


def test_blueprint_validated_creation():
    event = BlueprintValidated(
        blueprint_id=uuid4(),
        is_valid=True,
        validation_notes=["looks good"],
    )
    assert event.is_valid is True
    assert len(event.validation_notes) == 1
