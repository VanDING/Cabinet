from __future__ import annotations

import json
import os
import tempfile

import pytest

from cabinet.core.designer.template_store import TemplateStore
from cabinet.core.pipes.registry import PipeRegistry
from cabinet.models.pipes import Pipe, ReasoningStrategy


@pytest.fixture
def registry():
    return PipeRegistry()


@pytest.fixture
def store(registry):
    return TemplateStore(pipe_registry=registry)


@pytest.mark.asyncio
async def test_search_returns_matching_pipes(store, registry):
    pipe = Pipe(
        name="HR招聘流程",
        description="完整的招聘管理流程，包括简历筛选和面试安排",
        kind="composite",
        system_prompt="你是一个招聘管理助手",
        metadata={"tags": ["hr", "招聘", "recruitment"]},
    )
    await registry.register(pipe)

    results = await store.search("招聘", top_k=5)
    assert len(results) >= 1
    assert results[0].name == "HR招聘流程"


@pytest.mark.asyncio
async def test_search_returns_empty_when_no_match(store):
    results = await store.search("区块链挖矿", top_k=5)
    assert results == []


@pytest.mark.asyncio
async def test_search_respects_top_k(store, registry):
    for i in range(5):
        pipe = Pipe(
            name=f"数据分析管道{i}",
            description=f"分析{i}号数据源",
            kind="atomic",
            system_prompt="test",
            metadata={"tags": ["data", "analysis"]},
        )
        await registry.register(pipe)

    results = await store.search("数据分析", top_k=3)
    assert len(results) <= 3


@pytest.mark.asyncio
async def test_load_builtin_templates(store, registry):
    with tempfile.TemporaryDirectory() as tmpdir:
        pipe_data = {
            "format": "cabinet-pipe-v1",
            "pipe": {
                "name": "内置代码审查管道",
                "description": "代码审查",
                "kind": "atomic",
                "system_prompt": "review code",
                "tool_ids": [],
                "reasoning": {"temperature": 0.2},
                "input_schema": {},
                "output_schema": {},
                "metadata": {"tags": ["code", "review"], "builtin": True},
            },
        }
        pipe_file = os.path.join(tmpdir, "code_review.json")
        with open(pipe_file, "w", encoding="utf-8") as f:
            json.dump(pipe_data, f, ensure_ascii=False)

        loaded = await store.load_builtin_templates(tmpdir)
        assert len(loaded) >= 1

        all_pipes = await registry.list()
        matching = [p for p in all_pipes if p.name == "内置代码审查管道"]
        assert len(matching) == 1
