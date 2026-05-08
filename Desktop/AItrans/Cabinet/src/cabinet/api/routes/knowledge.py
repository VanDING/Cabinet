from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from cabinet.api.deps import get_current_user, get_runtime, require_permission
from cabinet.api.models import KnowledgeIndexRequest, KnowledgeQueryRequest, KnowledgeQueryResponse

if TYPE_CHECKING:
    from cabinet.runtime import CabinetRuntime

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/index")
@limiter.limit("30/minute")
async def index_documents(
    request: Request,
    req: KnowledgeIndexRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    if runtime.knowledge_base is None:
        raise HTTPException(status_code=503, detail="Knowledge base not configured")

    p = Path(req.path)
    documents = []
    if p.is_file():
        content = p.read_text(encoding="utf-8")
        documents.append({"content": content, "source": str(p)})
    elif p.is_dir():
        for f in p.rglob("*.md"):
            content = f.read_text(encoding="utf-8")
            documents.append({"content": content, "source": str(f)})
        for f in p.rglob("*.txt"):
            content = f.read_text(encoding="utf-8")
            documents.append({"content": content, "source": str(f)})

    if not documents:
        return {"indexed": 0}

    await runtime.knowledge_base.index(documents)
    return {"indexed": len(documents)}


@router.post("/query", response_model=KnowledgeQueryResponse)
@limiter.limit("30/minute")
async def query_knowledge(
    request: Request,
    req: KnowledgeQueryRequest,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
):
    if runtime.knowledge_base is None:
        raise HTTPException(status_code=503, detail="Knowledge base not configured")

    chunks = await runtime.knowledge_base.query(req.question, top_k=req.top_k)
    results = [{"content": c.content, "source": c.source} for c in chunks]
    return KnowledgeQueryResponse(results=results)
