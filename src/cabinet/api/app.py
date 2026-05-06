from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from cabinet import __version__
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime


logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)


def _sanitize_dict(data, sanitize_fn, max_depth: int = 10) -> dict | list | str:
    if max_depth <= 0:
        return data
    if isinstance(data, dict):
        return {k: _sanitize_dict(v, sanitize_fn, max_depth - 1) for k, v in data.items()}
    if isinstance(data, list):
        return [_sanitize_dict(v, sanitize_fn, max_depth - 1) for v in data]
    if isinstance(data, str):
        return sanitize_fn(data)
    return data


def create_app(runtime: CabinetRuntime, config: CabinetConfig) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await runtime.start()
        logger.info("Cabinet API started")
        logger.info("Cabinet API ready")
        yield
        await runtime.stop()
        logger.info("Cabinet API stopped")

    app = FastAPI(
        title="Cabinet API",
        version=__version__,
        description="AI Collaboration Framework API",
        lifespan=lifespan,
    )
    app.state.runtime = runtime
    app.state.config = config
    app.state.limiter = limiter

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from cabinet.core.observability import REQUEST_COUNT, REQUEST_LATENCY

    @app.middleware("http")
    async def prometheus_middleware(request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration = time.monotonic() - start
        endpoint = request.url.path
        REQUEST_COUNT.labels(
            method=request.method, endpoint=endpoint, status=response.status_code
        ).inc()
        REQUEST_LATENCY.labels(method=request.method, endpoint=endpoint).observe(duration)
        return response

    @app.middleware("http")
    async def input_sanitization_middleware(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1_000_000:
            return JSONResponse(status_code=413, content={"error": "Payload too large"})
        if request.method in ("POST", "PUT", "PATCH"):
            try:
                body = await request.body()
                if body:
                    import json
                    from cabinet.core.security import sanitize_input
                    data = json.loads(body)
                    sanitized = _sanitize_dict(data, sanitize_input)
                    new_body = json.dumps(sanitized).encode()
                    request._body = new_body
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
        return await call_next(request)

    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    from cabinet.api.routes import chat, config as config_routes, employees, health, knowledge, rooms, skills, workflows, agents

    app.include_router(health.router, tags=["Health"])
    app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
    app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
    app.include_router(skills.router, prefix="/api/skills", tags=["Skills"])
    app.include_router(knowledge.router, prefix="/api/knowledge", tags=["Knowledge"])
    app.include_router(rooms.router, prefix="/api/rooms", tags=["Rooms"])
    app.include_router(config_routes.router, prefix="/api/config", tags=["Config"])
    app.include_router(workflows.router, prefix="/api/workflows", tags=["Workflows"])
    app.include_router(agents.router, prefix="/api/agents", tags=["Agents"])

    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
    except ImportError:
        pass

    @app.exception_handler(KeyError)
    async def key_error_handler(request, exc):
        return JSONResponse(status_code=404, content={"error": "Not found", "detail": str(exc)})

    @app.exception_handler(ValueError)
    async def value_error_handler(request, exc):
        return JSONResponse(status_code=400, content={"error": "Bad request", "detail": str(exc)})

    @app.exception_handler(Exception)
    async def generic_error_handler(request, exc):
        import os as _os
        logger.exception("Unhandled exception")
        if _os.environ.get("CABINET_ENV") == "development":
            detail = str(exc)
        else:
            detail = "Internal server error"
        return JSONResponse(status_code=500, content={"error": "Internal error", "detail": detail})

    return app
