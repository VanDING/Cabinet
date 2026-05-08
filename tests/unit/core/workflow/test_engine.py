import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.workflow.engine import WorkflowEngine, EngineContext
from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    HumanApprovalNode,
    HumanNode,
    LoopNode,
    ParallelNode,
    RetryPolicy,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowEdge,
)


@pytest.mark.asyncio
async def test_engine_runs_linear_workflow():
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="linear",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"input": "test"})
    assert str(trigger_id) in results
    assert results[str(trigger_id)]["triggered"] is True
    assert str(skill_id) in results
    assert "output" in results[str(skill_id)]
    assert "__end__" in results


@pytest.mark.asyncio
async def test_engine_condition_node_branches():
    trigger_id = uuid4()
    cond_id = uuid4()
    true_id = uuid4()
    false_id = uuid4()
    end_true_id = uuid4()
    end_false_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="conditional",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            ConditionNode(id=cond_id, expression="x > 0", true_next=true_id, false_next=false_id),
            SkillNode(id=true_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=false_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_true_id),
            EndNode(id=end_false_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=cond_id),
            WorkflowEdge(source_node_id=true_id, target_node_id=end_true_id),
            WorkflowEdge(source_node_id=false_id, target_node_id=end_false_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"x": 1})
    assert str(cond_id) in results
    assert "condition_result" in results[str(cond_id)]


@pytest.mark.asyncio
async def test_engine_parallel_node():
    trigger_id = uuid4()
    branch_a_id = uuid4()
    branch_b_id = uuid4()
    parallel_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="parallel",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            ParallelNode(id=parallel_id, branch_node_ids=[branch_a_id, branch_b_id]),
            SkillNode(id=branch_a_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=branch_b_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=parallel_id),
            WorkflowEdge(source_node_id=branch_a_id, target_node_id=end_id),
            WorkflowEdge(source_node_id=branch_b_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert str(parallel_id) in results
    assert str(branch_a_id) in results[str(parallel_id)]
    assert str(branch_b_id) in results[str(parallel_id)]


@pytest.mark.asyncio
async def test_engine_human_approval_node_pauses():
    trigger_id = uuid4()
    approval_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic", message_template="Approve?"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert "__paused__" in results
    assert results["__paused__"]["decision_type"] == "strategic"
    assert "__end__" not in results


@pytest.mark.asyncio
async def test_engine_loop_node_executes_body():
    trigger_id = uuid4()
    loop_id = uuid4()
    body_a_id = uuid4()
    body_b_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="count", max_iterations=2, body_entry_id=body_a_id),
            SkillNode(id=body_a_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=body_b_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"items": [1, 2, 3]})
    assert str(loop_id) in results
    loop_result = results[str(loop_id)]
    assert "iterations" in loop_result


@pytest.mark.asyncio
async def test_engine_no_trigger_node_raises():
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="no_trigger",
        kind="composite_skill",
        nodes=[EndNode(id=end_id)],
        edges=[],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    with pytest.raises(ValueError, match="no trigger node"):
        await engine.run(workflow, {})


@pytest.mark.asyncio
async def test_engine_calls_on_node_completed():
    from uuid import UUID

    trigger_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="callback",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=end_id),
        ],
    )

    completed_nodes: list[tuple[UUID, dict]] = []

    async def on_completed(node_id: UUID, result: dict):
        completed_nodes.append((node_id, result))

    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    await engine.run(workflow, {}, on_node_completed=on_completed)
    assert len(completed_nodes) == 1
    assert completed_nodes[0][0] == trigger_id
    assert completed_nodes[0][1]["triggered"] is True


@pytest.mark.asyncio
async def test_engine_with_knowledge_base():
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[])
    engine = WorkflowEngine(
        agent_factory=StubAgentFactory(),
        knowledge_base=kb,
    )
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="kb_test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    results = await engine.run(workflow, {"input": "test"})
    assert str(skill_id) in results
    assert "__end__" in results


@pytest.mark.asyncio
async def test_engine_skill_node_queries_knowledge_when_required():
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase, DocumentChunk

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[
        DocumentChunk(content="Domain knowledge", source="docs"),
    ])
    engine = WorkflowEngine(
        agent_factory=StubAgentFactory(),
        knowledge_base=kb,
    )
    trigger_id = uuid4()
    knowledge_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="kb_required",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4(), requires_knowledge=[knowledge_id]),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    results = await engine.run(workflow, {"input": "test"})
    assert str(skill_id) in results
    kb.query.assert_called()


@pytest.mark.asyncio
async def test_engine_subgraph_execution():
    trigger_id = uuid4()
    skill_a_id = uuid4()
    skill_b_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="subgraph",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_a_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=skill_b_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_a_id),
            WorkflowEdge(source_node_id=skill_a_id, target_node_id=skill_b_id),
            WorkflowEdge(source_node_id=skill_b_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"input": "test"})
    assert str(trigger_id) in results
    assert str(skill_a_id) in results
    assert str(skill_b_id) in results
    assert "__end__" in results


@pytest.mark.asyncio
async def test_engine_human_approval_pauses_with_graph_result():
    trigger_id = uuid4()
    approval_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval_resume",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert "__paused__" in results
    assert results["__paused__"]["node_id"] == str(approval_id)


@pytest.mark.asyncio
async def test_engine_loop_count_mode():
    trigger_id = uuid4()
    body_id = uuid4()
    loop_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="count_loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="count", max_iterations=3, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert str(loop_id) in results
    assert results[str(loop_id)]["completed"] is True
    assert results[str(loop_id)]["iterations"] == 3


@pytest.mark.asyncio
async def test_engine_retry_on_skill_node_failure():
    from unittest.mock import AsyncMock
    from cabinet.agents.protocol import AgentOutput

    call_count = 0

    class FailOnceFactory:
        async def create_agent(self, employee_id, role):
            nonlocal call_count
            agent = AsyncMock()
            call_count += 1
            if call_count == 1:
                agent.execute = AsyncMock(side_effect=RuntimeError("transient error"))
            else:
                agent.execute = AsyncMock(return_value=AgentOutput(content="recovered", employee_id=uuid4()))
            return agent

    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="retry_test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4(), retry_policy=RetryPolicy(max_retries=2, backoff_base=0.01, backoff_max=0.1)),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=FailOnceFactory())
    results = await engine.run(workflow, {})
    assert str(skill_id) in results
    assert results[str(skill_id)]["output"] == "recovered"


@pytest.mark.asyncio
async def test_engine_retry_exhausted_sends_to_dlq():
    from unittest.mock import AsyncMock

    class AlwaysFailFactory:
        async def create_agent(self, employee_id, role):
            agent = AsyncMock()
            agent.execute = AsyncMock(side_effect=RuntimeError("persistent error"))
            return agent

    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="retry_exhausted",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4(), retry_policy=RetryPolicy(max_retries=1, backoff_base=0.01, backoff_max=0.1)),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )

    dlq_entries = []

    class MockDLQ:
        async def enqueue(self, **kwargs):
            dlq_entries.append(kwargs)
            return "dlq-id"

    engine = WorkflowEngine(agent_factory=AlwaysFailFactory(), dead_letter_queue=MockDLQ())
    results = await engine.run(workflow, {})
    assert str(skill_id) in results
    assert results[str(skill_id)].get("failed") is True
    assert len(dlq_entries) == 1


@pytest.mark.asyncio
async def test_engine_human_node_with_handler():
    trigger_id = uuid4()
    human_id = uuid4()
    end_id = uuid4()

    async def mock_handler(node, context_data):
        return {"approved": True, "reviewer": "alice"}

    workflow = Workflow(
        project_id=uuid4(),
        name="human_handler",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanNode(id=human_id, employee_id=uuid4(), prompt="Review this"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=human_id),
            WorkflowEdge(source_node_id=human_id, target_node_id=end_id),
        ],
    )
    ctx = EngineContext(human_input_handler=mock_handler)
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {}, context=ctx)
    assert str(human_id) in results
    assert results[str(human_id)]["approved"] is True


@pytest.mark.asyncio
async def test_engine_human_node_without_handler_pauses():
    trigger_id = uuid4()
    human_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="human_pause",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanNode(id=human_id, employee_id=uuid4(), prompt="Review this"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=human_id),
            WorkflowEdge(source_node_id=human_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert str(human_id) in results
    assert results[str(human_id)]["__paused__"] is True


@pytest.mark.asyncio
async def test_engine_loop_condition_mode():
    trigger_id = uuid4()
    body_id = uuid4()
    loop_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="condition_loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="condition", condition_expr="context.counter < 3", max_iterations=10, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"counter": 0})
    assert str(loop_id) in results
    assert results[str(loop_id)]["completed"] is True
    assert results[str(loop_id)]["iterations"] <= 10


@pytest.mark.asyncio
async def test_engine_loop_iterator_mode():
    trigger_id = uuid4()
    body_id = uuid4()
    loop_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="iterator_loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="iterator", iterator_expr="context.items", max_iterations=100, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"items": ["a", "b", "c"]})
    assert str(loop_id) in results
    assert results[str(loop_id)]["completed"] is True
    assert results[str(loop_id)]["iterations"] == 3


# ── V0.2.0 ExecutionJudge integration tests ──────────────────────────

import uuid
from cabinet.core.harness.judge import DefaultExecutionJudge


def _make_workflow(nodes, edges=None):
    return Workflow(
        project_id=uuid.uuid4(),
        name="test_flow",
        kind="team",
        nodes=nodes,
        edges=edges or [],
    )


@pytest.mark.asyncio
async def test_engine_accepts_execution_judge():
    engine = WorkflowEngine(
        agent_factory=StubAgentFactory(),
        execution_judge=DefaultExecutionJudge(),
    )
    assert engine._execution_judge is not None


@pytest.mark.asyncio
async def test_condition_node_calls_judge_on_none_result():
    judge = DefaultExecutionJudge()
    engine = WorkflowEngine(
        agent_factory=StubAgentFactory(),
        execution_judge=judge,
    )

    true_id = uuid.uuid4()
    false_id = uuid.uuid4()
    end_id = uuid.uuid4()

    cond_node = ConditionNode(
        id=uuid.uuid4(),
        name="test_cond",
        expression="undefined_var",
        true_next=true_id,
        false_next=false_id,
    )
    trigger = TriggerNode(id=uuid.uuid4(), trigger_type="manual")
    end = EndNode(id=end_id)

    workflow = _make_workflow(
        [trigger, cond_node, end],
        edges=[
            WorkflowEdge(source_node_id=trigger.id, target_node_id=cond_node.id),
            WorkflowEdge(source_node_id=cond_node.id, target_node_id=true_id),
            WorkflowEdge(source_node_id=true_id, target_node_id=end_id),
        ],
    )

    result = await engine.run(workflow, inputs={})
    # L1 judge decides choose_path → auto-continues to true_id (no pause)
    cond_result = result.get(str(cond_node.id), {})
    assert "judge_decision" in cond_result
    assert cond_result["judge_decision"]["level"] == "L1"
    assert cond_result["judge_decision"]["action"] == "choose_path"
