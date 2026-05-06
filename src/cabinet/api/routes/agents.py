from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from cabinet.api.deps import get_runtime

router = APIRouter()


class DiscoverRequest(BaseModel):
    role: str | None = None
    skill: str | None = None


class ComposeTeamRequest(BaseModel):
    task: str
    required_roles: list[str] | None = None
    required_skills: list[str] | None = None
    strategy: str = "collaborative"


class HandoffRequest(BaseModel):
    from_agent_id: str
    to_agent_id: str
    task_description: str
    context_snapshot: dict = {}
    reason: str = "delegation"


@router.get("/pool/status")
async def agent_pool_status(runtime=Depends(get_runtime)):
    health = await runtime.agent_pool.health_check()
    return health


@router.post("/discover")
async def agent_discover(request: DiscoverRequest, runtime=Depends(get_runtime)):
    results = await runtime.capability_registry.discover(
        role=request.role, skill=request.skill,
    )
    return {
        "agents": [
            {
                "agent_id": str(c.agent_id), "role": c.role,
                "skills": c.skills, "current_load": c.current_load,
                "max_concurrent_tasks": c.max_concurrent_tasks,
            }
            for c in results
        ],
    }


@router.post("/compose-team")
async def agent_compose_team(request: ComposeTeamRequest, runtime=Depends(get_runtime)):
    from cabinet.agents.composer import TeamComposer
    composer = TeamComposer(runtime.capability_registry)
    composition = await composer.compose(
        task=request.task,
        required_roles=request.required_roles,
        required_skills=request.required_skills,
        strategy=request.strategy,
    )
    return {
        "id": str(composition.id), "task": composition.task,
        "strategy": composition.strategy,
        "leader_id": str(composition.leader_id) if composition.leader_id else None,
        "members": [
            {
                "agent_id": str(m.agent_id), "role": m.role,
                "skills": m.skills, "assigned_task": m.assigned_task,
            }
            for m in composition.members
        ],
    }


@router.post("/handoff")
async def agent_handoff(request: HandoffRequest, runtime=Depends(get_runtime)):
    from cabinet.agents.handoff import HandoffRequest as HR
    try:
        hr = HR(
            from_agent_id=UUID(request.from_agent_id),
            to_agent_id=UUID(request.to_agent_id),
            task_description=request.task_description,
            context_snapshot=request.context_snapshot,
            reason=request.reason,
        )
        response = await runtime.handoff_manager.request_handoff(hr)
        if response is None:
            return {"status": "timeout", "accepted": False}
        return {
            "status": "accepted" if response.accepted else "rejected",
            "accepted": response.accepted,
            "message": response.message,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/mailbox/{agent_id}")
async def agent_mailbox_status(agent_id: str, runtime=Depends(get_runtime)):
    try:
        aid = UUID(agent_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid agent_id")
    mailbox = runtime.mailbox_router.get_mailbox(aid)
    if mailbox is None:
        return {"agent_id": agent_id, "registered": False}
    return {"agent_id": agent_id, "registered": True}
