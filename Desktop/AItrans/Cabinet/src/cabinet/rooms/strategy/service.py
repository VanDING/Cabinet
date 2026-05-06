from __future__ import annotations

import logging
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.core.parsing import BlueprintOutput, BlueprintValidationResult, parse_llm_json
from cabinet.models.events import StrategyDecodeResult
from cabinet.rooms.meeting.models import DeliberationOutput
from cabinet.rooms.strategy.domain_events import BlueprintDecoded, BlueprintValidated
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)

try:
    from cabinet.core.observability import ROOM_OPERATION, get_tracer

    _tracer = get_tracer("cabinet.strategy")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

logger = logging.getLogger(__name__)


class StrategyDecoderService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: AgentFactory,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._blueprints: dict[UUID, ActionBlueprint] = {}
        self._validations: dict[UUID, BlueprintValidation] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, BlueprintDecoded):
            domains = [ActionDomain(name=d, goal="") for d in event.action_domains]
            self._blueprints[event.blueprint_id] = ActionBlueprint(
                id=event.blueprint_id,
                project_id=uuid4(),
                source_proposal_id=event.proposal_session_id,
                domains=domains,
                execution_order=[[d.name] for d in domains],
                global_constraints=event.constraints,
            )
            cross_room.append(
                (
                    "strategy.decode_result",
                    StrategyDecodeResult(
                        action_domains=event.action_domains,
                        constraints=event.constraints,
                        success_criteria=event.success_criteria,
                    ),
                    None,
                )
            )
        elif isinstance(event, BlueprintValidated):
            self._validations[event.blueprint_id] = BlueprintValidation(
                valid=event.is_valid,
                issues=event.validation_notes,
                domain_count_ok=True,
                dependencies_resolved=True,
                criteria_measurable=True,
            )
        return cross_room

    async def decode(
        self,
        proposal: DeliberationOutput,
        context: DecodeContext,
    ) -> ActionBlueprint:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="strategy", operation="decode").inc()
        blueprint_id = uuid4()
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "strategist")
            agent_context = AgentContext(model="default", temperature=0.5)
            output = await agent.execute(
                f"Transform the following proposal into a structured action blueprint.\n\n"
                f"Proposal: {proposal.proposal.proposal_text}\n"
                f"Source Session: {proposal.session_id}\n"
                f"Project: {context.project_id}\n"
                f"Existing Constraints: {context.existing_constraints}\n\n"
                f"Provide:\n"
                f"1. Action domains (list of domain names)\n"
                f"2. Constraints (list of constraint descriptions)\n"
                f"3. Success criteria (list of measurable criteria)",
                agent_context,
            )
            action_domains, constraints, success_criteria = self._parse_blueprint_output(output.content)
        except Exception as exc:
            logger.exception("LLM call failed in strategy decode: %s", exc)
            action_domains = ["primary"]
            constraints = ["budget"]
            success_criteria = ["revenue increase"]
        event = BlueprintDecoded(
            blueprint_id=blueprint_id,
            proposal_session_id=proposal.session_id,
            action_domains=action_domains,
            constraints=constraints,
            success_criteria=success_criteria,
        )
        await self._publish_and_apply(event)
        bp = self._blueprints[blueprint_id]
        return bp.model_copy(update={"project_id": context.project_id})

    async def validate_blueprint(
        self,
        blueprint: ActionBlueprint,
    ) -> BlueprintValidation:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="strategy", operation="validate_blueprint").inc()
        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.3)
        domains_text = "\n".join(f"- {d.name}: {d.goal}" for d in blueprint.domains)
        output = await agent.execute(
            f"Validate this action blueprint:\n\n"
            f"Domains:\n{domains_text}\n"
            f"Constraints: {blueprint.global_constraints}\n"
            f"Execution Order: {blueprint.execution_order}\n\n"
            f"Check: 1) Domain completeness 2) Dependency resolution 3) Criteria measurability\n"
            f"Respond with: VALID or INVALID, followed by specific issues.",
            context,
        )
        is_valid, notes = self._parse_validation_output(output.content)
        event = BlueprintValidated(
            blueprint_id=blueprint.id,
            is_valid=is_valid,
            validation_notes=notes,
        )
        await self._publish_and_apply(event)
        return self._validations[blueprint.id]

    @staticmethod
    def _parse_blueprint_output(content: str) -> tuple[list[str], list[str], list[str]]:
        parsed = parse_llm_json(content, BlueprintOutput)
        if parsed is not None:
            domains = parsed.domains if parsed.domains else ["primary"]
            constraints = parsed.constraints if parsed.constraints else ["budget"]
            criteria = parsed.criteria if parsed.criteria else ["revenue increase"]
            return domains, constraints, criteria
        action_domains: list[str] = []
        constraints: list[str] = []
        success_criteria: list[str] = []
        current: str | None = None
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if not line:
                continue
            lower = line.lower()
            if "domain" in lower and "action" in lower:
                current = "domains"
            elif "constraint" in lower:
                current = "constraints"
            elif "criterion" in lower or "criteria" in lower or "success" in lower:
                current = "criteria"
            elif current == "domains":
                action_domains.append(line)
            elif current == "constraints":
                constraints.append(line)
            elif current == "criteria":
                success_criteria.append(line)
        if not action_domains:
            action_domains = ["primary"]
        if not constraints:
            constraints = ["budget"]
        if not success_criteria:
            success_criteria = ["revenue increase"]
        return action_domains, constraints, success_criteria

    @staticmethod
    def _parse_validation_output(content: str) -> tuple[bool, list[str]]:
        parsed = parse_llm_json(content, BlueprintValidationResult)
        if parsed is not None:
            return parsed.is_valid, parsed.notes if parsed.notes else ["validated"]
        is_valid = "INVALID" not in content.upper()[:50]
        notes = [line.strip().lstrip("- ") for line in content.split("\n") if line.strip()]
        if not notes:
            notes = ["validated"]
        return is_valid, notes
