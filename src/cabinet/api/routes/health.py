from __future__ import annotations

import time

from fastapi import APIRouter, Request

from cabinet import __version__
from cabinet.api.models import ComponentHealth, HealthResponse

router = APIRouter()

_start_time: float = time.monotonic()


@router.get("/health", response_model=HealthResponse)
async def liveness():
    return HealthResponse(
        status="healthy",
        version=__version__,
        components=[],
        uptime_seconds=time.monotonic() - _start_time,
    )


@router.get("/ready", response_model=HealthResponse)
async def readiness(request: Request):
    runtime = request.app.state.runtime
    result = await runtime.health_check()
    return HealthResponse(
        status=result["status"],
        version=result["version"],
        components=[ComponentHealth(**c) for c in result["components"]],
        uptime_seconds=result["uptime_seconds"],
    )
