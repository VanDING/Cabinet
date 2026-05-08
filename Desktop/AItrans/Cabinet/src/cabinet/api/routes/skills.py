from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from cabinet.api.deps import get_config, get_current_user, get_runtime, require_permission
from cabinet.api.models import SkillRunRequest, SkillRunResponse

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("")
@limiter.limit("30/minute")
async def list_skills(
    request: Request,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
):
    skills = await runtime.tool_registry.list_skills()
    return [
        {
            "name": s.name,
            "kind": s.kind,
            "description": s.description,
            "requires_knowledge": bool(s.requires_knowledge),
        }
        for s in skills
    ]


@router.post("/load")
@limiter.limit("30/minute")
async def load_skill(
    request: Request,
    path: str,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    config: "CabinetConfig" = Depends(get_config),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    from cabinet.core.tools.skill_store import SkillStore

    store = SkillStore(skills_dir=config.skills_dir)
    skill = await store.load_skill(path, runtime.tool_registry)
    return {"name": skill.name, "description": skill.description}


@router.post("/{name}/run", response_model=SkillRunResponse)
@limiter.limit("30/minute")
async def run_skill(
    request: Request,
    name: str,
    req: SkillRunRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    try:
        output = await runtime.tool_registry.execute(name, req.inputs)
        return SkillRunResponse(skill_name=name, output=output.content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
