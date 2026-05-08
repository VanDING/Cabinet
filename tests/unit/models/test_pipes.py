# tests/unit/models/test_pipes.py
from __future__ import annotations

import uuid

from cabinet.models.pipes import Persona, Pipe, ReasoningStrategy


def test_reasoning_strategy_defaults():
    rs = ReasoningStrategy()
    assert rs.temperature == 0.3
    assert rs.max_tokens is None
    assert rs.reasoning_effort is None
    assert rs.chain_of_thought is False
    assert rs.stop_sequences == []


def test_reasoning_strategy_custom():
    rs = ReasoningStrategy(temperature=0.1, max_tokens=2000, chain_of_thought=True)
    assert rs.temperature == 0.1
    assert rs.max_tokens == 2000
    assert rs.chain_of_thought is True


def test_pipe_creation_minimal():
    pipe = Pipe(
        name="测试管道",
        description="一个测试用管道",
        kind="atomic",
        system_prompt="你是一个测试助手",
    )
    assert pipe.name == "测试管道"
    assert pipe.kind == "atomic"
    assert pipe.system_prompt == "你是一个测试助手"
    assert pipe.tool_ids == []
    assert pipe.version == 1
    assert pipe.id is not None
    assert isinstance(pipe.reasoning, ReasoningStrategy)
    assert pipe.reasoning.temperature == 0.3


def test_pipe_with_tools_and_reasoning():
    tool_ids = [uuid.uuid4(), uuid.uuid4()]
    pipe = Pipe(
        name="财经分析管道",
        description="财务报表分析",
        kind="atomic",
        system_prompt="你是资深财务分析师",
        tool_ids=tool_ids,
        reasoning=ReasoningStrategy(temperature=0.2, chain_of_thought=True),
        input_schema={"type": "object", "properties": {"report": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"analysis": {"type": "string"}}},
        metadata={"author": "community", "tags": ["finance"]},
    )
    assert len(pipe.tool_ids) == 2
    assert pipe.reasoning.temperature == 0.2
    assert pipe.reasoning.chain_of_thought is True
    assert "report" in pipe.input_schema["properties"]
    assert "analysis" in pipe.output_schema["properties"]
    assert pipe.metadata["author"] == "community"


def test_pipe_composite_kind():
    pipe = Pipe(
        name="复合管道",
        description="composite pipe",
        kind="composite",
        system_prompt="组合多个能力",
    )
    assert pipe.kind == "composite"


def test_persona_creation():
    persona = Persona(
        name="财务小王",
        expertise=["财务报表分析", "税务筹划"],
        traits={"style": "concise", "tone": "professional"},
    )
    assert persona.name == "财务小王"
    assert "财务报表分析" in persona.expertise
    assert persona.traits["style"] == "concise"
    assert persona.collaboration_summary == {}
    assert persona.memory_refs == []
    assert persona.id is not None


def test_persona_update_summary():
    persona = Persona(
        name="分析员",
        expertise=["数据分析"],
    )
    persona.collaboration_summary["preferred_format"] = "bullet_points"
    persona.collaboration_summary["last_interaction"] = "2026-05-08"
    assert persona.collaboration_summary["preferred_format"] == "bullet_points"


def test_persona_memory_refs():
    mem_id = uuid.uuid4()
    persona = Persona(
        name="研究员",
        expertise=["市场研究"],
        memory_refs=[mem_id],
    )
    assert len(persona.memory_refs) == 1
    assert persona.memory_refs[0] == mem_id
