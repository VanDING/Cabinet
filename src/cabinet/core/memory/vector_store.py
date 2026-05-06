from __future__ import annotations

import asyncio
import logging
import time
from uuid import UUID

import chromadb
from chromadb.api.types import EmbeddingFunction

from cabinet.models.primitives import MemoryItem, MemoryScope


logger = logging.getLogger(__name__)

try:
    from cabinet.core.observability import VECTOR_OPERATION_LATENCY

    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False


class ChromaDBMemoryStore:
    def __init__(
        self, persist_dir: str | None = None, embedding_function: EmbeddingFunction | None = None
    ):
        if persist_dir:
            self._client = chromadb.PersistentClient(path=persist_dir)
        else:
            self._client = chromadb.Client()
        collection_kwargs = {
            "name": "cabinet_memory",
            "metadata": {"hnsw:space": "cosine"},
        }
        if embedding_function is not None:
            collection_kwargs["embedding_function"] = embedding_function
        self._collection = self._client.get_or_create_collection(**collection_kwargs)

    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None:
        start = time.monotonic()
        await asyncio.to_thread(
            self._collection.upsert,
            ids=[key],
            documents=[value.content],
            metadatas=[{"scope": scope.value, "owner_id": str(value.owner_id), "key": key}],
        )
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="store").observe(time.monotonic() - start)

    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None:
        results = await asyncio.to_thread(
            self._collection.get, ids=[key], where={"scope": scope.value}
        )
        if not results["documents"]:
            return None
        metadata = results["metadatas"][0]
        return MemoryItem(
            owner_id=UUID(metadata["owner_id"]),
            scope=scope,
            content=results["documents"][0],
        )

    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        start = time.monotonic()
        count = await asyncio.to_thread(self._collection.count)
        if count == 0:
            return []
        results = await asyncio.to_thread(
            self._collection.query,
            query_texts=[query],
            n_results=min(limit, count),
            where={"scope": scope.value},
        )
        items = []
        for i, doc in enumerate(results["documents"][0]):
            metadata = results["metadatas"][0][i]
            items.append(
                MemoryItem(
                    owner_id=UUID(metadata["owner_id"]),
                    scope=scope,
                    content=doc,
                )
            )
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="search").observe(time.monotonic() - start)
        return items

    async def delete(self, key: str, scope: MemoryScope) -> None:
        await asyncio.to_thread(
            self._collection.delete, ids=[key], where={"scope": scope.value}
        )

    async def initialize(self) -> None:
        pass

    async def close(self) -> None:
        if hasattr(self._client, "_system"):
            self._client._system.stop()
        logger.info("ChromaDBMemoryStore closed")
