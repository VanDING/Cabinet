from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from cabinet.api.deps import get_config, get_current_user, get_runtime

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("")
@limiter.limit("30/minute")
async def get_current_config(
    request: Request,
    config: "CabinetConfig" = Depends(get_config),
    _user: dict = Depends(get_current_user),
):
    return {
        "organization_name": config.organization.name,
        "captain_id": config.organization.captain_id,
        "default_project": str(config.default_project),
        "model_config_path": config.model_config_path,
        "skills_dir": config.skills_dir,
        "knowledge_dir": config.knowledge_dir,
        "employees_path": config.employees_path,
    }


@router.get("/models")
@limiter.limit("30/minute")
async def get_models(
    request: Request,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
):
    models = runtime.gateway.list_models()
    return [{"id": m.id, "provider": m.provider, "context_window": m.context_window} for m in models]
