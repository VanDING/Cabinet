from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

_security = HTTPBearer(auto_error=False)
_logger = logging.getLogger(__name__)


def get_runtime(request: Request) -> CabinetRuntime:
    return request.app.state.runtime


def get_config(request: Request) -> CabinetConfig:
    return request.app.state.config


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(_security),
    request: Request = None,
) -> dict:
    config: CabinetConfig = request.app.state.config

    if not config.auth_required and not config.api_token and not config.api_tokens:
        return {"role": "admin", "token_label": "anonymous"}

    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    token = credentials.credentials

    if config.api_token and token == config.api_token:
        user = {"role": "admin", "token_label": "legacy"}
    else:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        matched = None
        for entry in config.api_tokens:
            if entry.token_hash == token_hash:
                matched = entry
                break
        if matched is None:
            raise HTTPException(status_code=401, detail="Invalid API token")
        user = {"role": matched.role.value, "token_label": matched.label}

    try:
        runtime = request.app.state.runtime
        if hasattr(runtime, "_audit_store") and runtime._audit_store is not None:
            from cabinet.core.audit import AuditEvent
            await runtime._audit_store.log(AuditEvent(
                action="auth.login",
                actor=user["token_label"],
                role=user["role"],
                resource_type="api_token",
                resource_id="session",
                ip_address=request.client.host if request.client else "",
            ))
    except Exception:
        _logger.warning("audit log write failed", exc_info=True)

    return user


def require_permission(permission: str):
    from cabinet.core.auth import Permission, Role, has_permission

    async def _check(request: Request, user: dict = Security(get_current_user)) -> dict:
        try:
            perm = Permission(permission)
            role = Role(user.get("role", "viewer"))
        except ValueError:
            raise HTTPException(status_code=403, detail="Invalid role or permission")
        if not has_permission(role, perm):
            raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")
        return user
    return _check
