from __future__ import annotations

import uuid

import pytest

from cabinet.core.pipes.registry import PipeRegistry
from cabinet.models.pipes import Pipe, ReasoningStrategy


@pytest.fixture
def registry():
    return PipeRegistry()


@pytest.mark.asyncio
async def test_register_and_get(registry):
    pipe = Pipe(
        name="测试管道",
        description="测试",
        kind="atomic",
        system_prompt="你是一个测试助手",
    )
    await registry.register(pipe)
    retrieved = await registry.get(pipe.id)
    assert retrieved is not None
    assert retrieved.name == "测试管道"


@pytest.mark.asyncio
async def test_get_nonexistent(registry):
    result = await registry.get(uuid.uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_list_empty(registry):
    pipes = await registry.list()
    assert pipes == []


@pytest.mark.asyncio
async def test_list_all(registry):
    for i in range(3):
        await registry.register(Pipe(
            name=f"管道{i}",
            description="test",
            kind="atomic",
            system_prompt="test",
        ))
    pipes = await registry.list()
    assert len(pipes) == 3


@pytest.mark.asyncio
async def test_list_filter_by_kind(registry):
    await registry.register(Pipe(
        name="原子管道", description="t", kind="atomic", system_prompt="t",
    ))
    await registry.register(Pipe(
        name="复合管道", description="t", kind="composite", system_prompt="t",
    ))
    atomic = await registry.list(kind="atomic")
    assert len(atomic) == 1
    assert atomic[0].kind == "atomic"
    composite = await registry.list(kind="composite")
    assert len(composite) == 1
    assert composite[0].kind == "composite"


@pytest.mark.asyncio
async def test_export(registry):
    pipe = Pipe(
        name="导出管道",
        description="用于社区分享",
        kind="atomic",
        system_prompt="test prompt",
        reasoning=ReasoningStrategy(temperature=0.2, chain_of_thought=True),
        metadata={"author": "test-user", "tags": ["test", "export"]},
    )
    await registry.register(pipe)
    exported = await registry.export(pipe.id)
    assert exported["format"] == "cabinet-pipe-v1"
    assert exported["pipe"]["name"] == "导出管道"
    assert exported["pipe"]["reasoning"]["temperature"] == 0.2
    assert "author" in exported["pipe"]["metadata"]


@pytest.mark.asyncio
async def test_export_nonexistent(registry):
    with pytest.raises(ValueError, match="Pipe not found"):
        await registry.export(uuid.uuid4())


@pytest.mark.asyncio
async def test_import_from_dict(registry):
    data = {
        "format": "cabinet-pipe-v1",
        "pipe": {
            "name": "导入管道",
            "description": "从社区导入",
            "kind": "atomic",
            "system_prompt": "imported prompt",
            "tool_ids": [],
            "reasoning": {"temperature": 0.5},
            "input_schema": {},
            "output_schema": {},
            "metadata": {"tags": ["import"]},
        },
    }
    pipe = await registry.import_from_dict(data)
    assert pipe.name == "导入管道"
    assert pipe.reasoning.temperature == 0.5


@pytest.mark.asyncio
async def test_import_from_dict_no_format_raises(registry):
    with pytest.raises(ValueError, match="format"):
        await registry.import_from_dict({"pipe": {}})
