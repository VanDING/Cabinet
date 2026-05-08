# tests/integration/test_v020_pipe_and_judge.py
from __future__ import annotations

import uuid

import pytest

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.harness.judge import DefaultExecutionJudge
from cabinet.core.harness.models import JudgeDecision
from cabinet.core.pipes.persona_registry import PersonaRegistry
from cabinet.core.pipes.registry import PipeRegistry
from cabinet.core.workflow.engine import WorkflowEngine
from cabinet.models.pipes import Pipe, ReasoningStrategy
from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowEdge,
)


class EscalatingJudge(DefaultExecutionJudge):
    """Test judge that always escalates ambiguous conditions (L2)."""

    async def judge_condition(self, node, context: dict) -> JudgeDecision:
        return JudgeDecision(level="L2", action="escalate", reasoning="test escalation")


@pytest.mark.asyncio
async def test_full_pipe_assemble_and_workflow_with_judge():
    """端到端：创建 Pipe + Persona → 装配 Employee → 工作流执行中触发 judge"""
    # 1. 创建管道
    pipe_registry = PipeRegistry()
    pipe = Pipe(
        name="数据分析管道",
        description="test",
        kind="atomic",
        system_prompt="分析数据并给出建议",
        reasoning=ReasoningStrategy(temperature=0.2, chain_of_thought=True),
    )
    await pipe_registry.register(pipe)

    # 2. 创建人格
    persona_registry = PersonaRegistry()
    persona = await persona_registry.create(
        name="数据小王",
        expertise=["统计分析"],
    )

    # 3. 装配 Employee
    factory = StubAgentFactory(pipe_registry=pipe_registry, persona_registry=persona_registry)
    agent = await factory.assemble_employee(pipe.id, persona.id, uuid.uuid4())

    assert agent.employee.pipe_id == pipe.id
    assert agent.employee.persona_id == persona.id
    assert agent.employee.name == "数据小王"

    # 4. 创建带条件分支的工作流（条件会触发 judge 暂停）
    judge = EscalatingJudge()

    true_id = uuid.uuid4()
    end_id = uuid.uuid4()

    cond_node = ConditionNode(
        id=uuid.uuid4(),
        name="ambiguous_condition",
        expression="undefined_var",
        true_next=true_id,
        false_next=end_id,
    )

    skill = SkillNode(
        id=true_id,
        name="analysis_step",
        skill_id=uuid.uuid4(),
        employee_id=agent.employee.id,
        inputs={},
    )

    trigger = TriggerNode(id=uuid.uuid4(), trigger_type="manual")
    end = EndNode(id=end_id)

    workflow = Workflow(
        project_id=uuid.uuid4(),
        name="integration_test",
        kind="team",
        nodes=[trigger, cond_node, skill, end],
        edges=[
            WorkflowEdge(source_node_id=trigger.id, target_node_id=cond_node.id),
            WorkflowEdge(source_node_id=cond_node.id, target_node_id=true_id),
            WorkflowEdge(source_node_id=true_id, target_node_id=end_id),
        ],
    )

    engine = WorkflowEngine(
        agent_factory=factory,
        execution_judge=judge,
    )

    result = await engine.run(workflow, inputs={})
    assert result is not None
    # 条件节点 eval 为 None → judge 介入 → 暂停
    paused = result.get("__paused__")
    assert paused is not None
    assert "judge_decision" in paused


@pytest.mark.asyncio
async def test_employee_backward_compatibility():
    """V0.1.0 Employee 创建方式仍然可用"""
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid.uuid4(), "analyst")
    assert agent.employee.pipe_id is None
    assert agent.employee.persona_id is None
    assert agent.employee.role == "analyst"


@pytest.mark.asyncio
async def test_pipe_registry_export_import_roundtrip():
    """管道导出再导入后保持一致"""
    registry = PipeRegistry()
    original = Pipe(
        name="导出测试管道",
        description="用于测试导出导入",
        kind="atomic",
        system_prompt="test prompt",
        reasoning=ReasoningStrategy(temperature=0.3, chain_of_thought=False),
        metadata={"author": "test"},
    )
    await registry.register(original)

    exported = await registry.export(original.id)
    imported = await registry.import_from_dict(exported)

    assert imported.name == original.name
    assert imported.system_prompt == original.system_prompt
    assert imported.reasoning.temperature == original.reasoning.temperature
