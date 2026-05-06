from __future__ import annotations

import json
import logging
import hashlib
import time as _time

import chromadb
from chromadb.api.types import EmbeddingFunction

from cabinet.core.knowledge.protocol import DocumentChunk


logger = logging.getLogger(__name__)

try:
    from cabinet.core.observability import VECTOR_OPERATION_LATENCY
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False


class ChromaDBKnowledgeBase:
    def __init__(
        self,
        persist_dir: str | None = None,
        embedding_function: EmbeddingFunction | None = None,
        collection_name: str = "cabinet_knowledge",
    ):
        if persist_dir:
            self._client = chromadb.PersistentClient(path=persist_dir)
        else:
            self._client = chromadb.Client()
        collection_kwargs = {
            "name": collection_name,
            "metadata": {"hnsw:space": "cosine"},
        }
        if embedding_function is not None:
            collection_kwargs["embedding_function"] = embedding_function
        self._collection = self._client.get_or_create_collection(**collection_kwargs)

    async def index(self, documents: list[dict]) -> None:
        ids = []
        contents = []
        metadatas = []
        for doc in documents:
            content = doc["content"]
            doc_id = hashlib.sha256(content.encode()).hexdigest()[:16]
            ids.append(doc_id)
            contents.append(content)
            metadatas.append(
                {"source": doc.get("source", ""), "metadata": json.dumps(doc.get("metadata", {}))}
            )
        self._collection.upsert(
            ids=ids,
            documents=contents,
            metadatas=metadatas,
        )
        logger.info("Indexed %d documents", len(documents))

    async def query(self, question: str, top_k: int = 5) -> list[DocumentChunk]:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        count = self._collection.count()
        if count == 0:
            return []
        results = self._collection.query(
            query_texts=[question],
            n_results=min(top_k, count),
        )
        chunks = []
        for i, doc in enumerate(results["documents"][0]):
            metadata = results["metadatas"][0][i]
            chunks.append(
                DocumentChunk(
                    content=doc,
                    source=metadata.get("source", ""),
                    metadata=json.loads(metadata.get("metadata", "{}"))
                    if isinstance(metadata.get("metadata"), str)
                    else metadata.get("metadata", {}),
                )
            )
        logger.info("Knowledge query: top_k=%d results=%d", top_k, len(chunks))
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="query").observe(
                _time.monotonic() - start
            )
        return chunks

    def close(self):
        if hasattr(self._client, "_system"):
            self._client._system.stop()
