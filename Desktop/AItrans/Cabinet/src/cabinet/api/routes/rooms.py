from typing import TYPE_CHECKING
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from cabinet.api.deps import get_config, get_current_user, get_runtime, require_permission
from cabinet.api.models import (
    DecisionRequest,
    MeetingRequest,
    ReviewRequest,
    StrategyRequest,
    TaskRequest,
)

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/meeting")
@limiter.limit("30/minute")
async def create_meeting(
    request: Request,
    req: MeetingRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    from cabinet.rooms.meeting.models import MeetingLevel

    level_map = {
        "free_draft": MeetingLevel.FREE_DRAFT,
        "multi_party": MeetingLevel.MULTI_PARTY,
        "expert_hearing": MeetingLevel.EXPERT_HEARING,
    }
    level = level_map.get(req.level, MeetingLevel.MULTI_PARTY)
    participants = [uuid4(), uuid4()]
    session = await runtime.meeting.start_session(
        topic=req.topic, level=level, participants=participants
    )
    for pid in participants:
        await runtime.meeting.add_perspective(session.id, pid)
    await runtime.meeting.cross_validate(session.id)
    result = await runtime.meeting.converge(session.id)
    return {
        "session_id": str(session.id),
        "topic": req.topic,
        "proposal": result.proposal_text,
        "confidence": result.confidence,
    }


@router.post("/decision")
@limiter.limit("30/minute")
async def create_decision(
    request: Request,
    req: DecisionRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    from cabinet.models.events import DecisionRequest as DecisionReq
    from cabinet.models.decisions import DecisionType

    dt_map = {dt.value: dt for dt in DecisionType}
    decision_type = dt_map.get(req.decision_type, DecisionType.STRATEGIC)
    request_obj = DecisionReq(
        decision_id=uuid4(),
        decision_type=decision_type.value,
        title=req.title,
        options=req.options,
    )
    decision = await runtime.decision.submit(request_obj)
    return {
        "decision_id": str(decision.id),
        "title": decision.title,
        "status": decision.status.value,
    }


@router.post("/task")
@limiter.limit("30/minute")
async def create_task(
    request: Request,
    req: TaskRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    from cabinet.models.events import TaskOrder

    order = TaskOrder(
        employee_id=uuid4(),
        skill_id=uuid4(),
        inputs={**req.inputs, "description": req.description},
    )
    task = await runtime.office.submit_task(order)
    return {
        "task_id": str(task.id),
        "status": task.status if isinstance(task.status, str) else task.status.value,
    }


@router.post("/strategy")
@limiter.limit("30/minute")
async def decode_strategy(
    request: Request,
    req: StrategyRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    from cabinet.rooms.meeting.models import ConvergenceResult, DeliberationOutput, DeliberationResult
    from cabinet.rooms.strategy.models import DecodeContext

    session_id = uuid4()
    proposal_output = DeliberationOutput(
        session_id=session_id,
        proposal=DeliberationResult(
            session_id=session_id,
            proposal_text=req.proposal,
            confidence=0.8,
            reasoning_summary="direct input",
            convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
            rounds_used=1,
            rumination_detected=False,
        ),
    )
    context = DecodeContext(
        project_id=uuid4(), captain_id="captain", existing_constraints=[]
    )
    blueprint = await runtime.strategy.decode(proposal_output, context)
    return {
        "blueprint_id": str(blueprint.id),
        "domains": [d.name for d in blueprint.domains],
    }


@router.post("/review")
@limiter.limit("30/minute")
async def start_review(
    request: Request,
    req: ReviewRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    config: "CabinetConfig" = Depends(get_config),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    from cabinet.rooms.summary.models import ReviewType

    rt_map = {
        "project_review": ReviewType.PROJECT_REVIEW,
        "org_optimization": ReviewType.ORG_OPTIMIZATION,
        "captain_insight": ReviewType.CAPTAIN_INSIGHT,
    }
    review_type = rt_map.get(req.review_type, ReviewType.PROJECT_REVIEW)
    project_id = uuid4() if req.project_id is None else req.project_id
    session = await runtime.summary.start_review(
        project_id=project_id, review_type=review_type
    )
    insights = await runtime.summary.generate_insights(session.id)
    return {
        "session_id": str(session.id),
        "insights": [i.content for i in insights],
    }
