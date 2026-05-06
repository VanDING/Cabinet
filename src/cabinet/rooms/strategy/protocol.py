from __future__ import annotations

from typing import Protocol, runtime_checkable

from cabinet.rooms.meeting.models import DeliberationOutput
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    BlueprintValidation,
    DecodeContext,
)


@runtime_checkable
class StrategyDecoder(Protocol):
    async def decode(
        self, proposal: DeliberationOutput, context: DecodeContext
    ) -> ActionBlueprint: ...
    async def validate_blueprint(self, blueprint: ActionBlueprint) -> BlueprintValidation: ...
