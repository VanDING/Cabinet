import hashlib
import uuid

import pytest

from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
from cabinet.core.knowledge.protocol import KnowledgeBase


class FakeEmbeddingFunction:
    def _embed(self, input):
        result = []
        for text in input:
            h = hashlib.md5(text.encode()).hexdigest()
            vector = [float(int(h[i:i+2], 16)) / 255.0 for i in range(0, 32, 2)]
            vector += [0.0] * (384 - len(vector))
            result.append(vector)
        return result

    def __call__(self, input):
        return self._embed(input)

    def embed_query(self, input):
        return self._embed(input)

    def name(self):
        return "fake"

    def is_legacy(self):
        return True


@pytest.fixture
async def kb():
    collection_name = f"test_kb_{uuid.uuid4().hex[:8]}"
    k = ChromaDBKnowledgeBase(embedding_function=FakeEmbeddingFunction(), collection_name=collection_name)
    yield k


def test_kb_satisfies_protocol(kb):
    assert isinstance(kb, KnowledgeBase)


@pytest.mark.asyncio
async def test_index_and_query(kb):
    docs = [
        {"content": "Cabinet is an AI collaboration framework", "source": "readme"},
        {"content": "The Captain is the user and decision maker", "source": "docs"},
    ]
    await kb.index(docs)
    results = await kb.query("What is Cabinet?", top_k=2)
    assert len(results) >= 1
    contents = [r.content for r in results]
    assert any("Cabinet" in c or "Captain" in c for c in contents)


@pytest.mark.asyncio
async def test_query_empty_kb(kb):
    results = await kb.query("anything", top_k=5)
    assert results == []


@pytest.mark.asyncio
async def test_document_chunk_has_source(kb):
    docs = [
        {"content": "HR policy document content", "source": "hr_policies"},
    ]
    await kb.index(docs)
    results = await kb.query("HR policy", top_k=1)
    assert len(results) >= 1
    assert results[0].source == "hr_policies"


@pytest.mark.asyncio
async def test_metadata_with_special_chars_is_safe(kb):
    docs = [
        {
            "content": "Test doc with tricky metadata",
            "source": "test",
            "metadata": {"key": "value with 'quotes' and __import__('os').name"},
        },
    ]
    await kb.index(docs)
    results = await kb.query("tricky metadata", top_k=1)
    assert len(results) >= 1
    assert isinstance(results[0].metadata, dict)
