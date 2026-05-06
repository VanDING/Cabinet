from typing import TYPE_CHECKING

import hmac
import logging

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from slowapi import Limiter
from slowapi.util import get_remote_address

from cabinet.api.deps import get_current_user, get_runtime
from cabinet.api.models import ChatRequest, ChatResponse

if TYPE_CHECKING:
    from cabinet.runtime import CabinetRuntime


logger = logging.getLogger(__name__)

try:
    from cabinet.core.observability import ACTIVE_CONNECTIONS

    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat(
    request: Request,
    req: ChatRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
):
    from cabinet.rooms.secretary.models import InteractionContext

    context = InteractionContext(captain_id=req.captain_id, channel="api")
    logger.info("Chat request from captain=%s", req.captain_id)
    result = await runtime.secretary.process_input(req.message, context)
    return ChatResponse(response=result.message, captain_id=req.captain_id)


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    runtime = websocket.app.state.runtime
    config = websocket.app.state.config

    if config.api_token:
        token = websocket.query_params.get("token")
        if not hmac.compare_digest(token or "", config.api_token):
            await websocket.close(code=4001, reason="Unauthorized")
            return

    captain_id = websocket.query_params.get("captain_id", "captain")

    if _OBSERVABILITY_ENABLED:
        ACTIVE_CONNECTIONS.inc()
    logger.info("WebSocket connection from captain=%s", captain_id)

    try:
        while True:
            data = await websocket.receive_text()
            if data == "/quit":
                await websocket.close()
                break

            from cabinet.rooms.secretary.models import InteractionContext

            context = InteractionContext(captain_id=captain_id, channel="api")
            response = runtime.secretary.process_input_stream(data, context)
            async for chunk in response.stream:
                await websocket.send_json({"type": "chunk", "content": chunk})
            await response.finalize()
            await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: captain=%s", captain_id)
        pass
    finally:
        if _OBSERVABILITY_ENABLED:
            ACTIVE_CONNECTIONS.dec()
