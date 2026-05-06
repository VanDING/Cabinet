import uuid

import pytest
from pydantic import ValidationError

from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    HumanApprovalNode,
    HumanNode,
    LoopNode,
    ParallelNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowEdge,
    WorkflowNode,
)


def test_trigger_node():
    node = TriggerNode(
        trigger_type="manual",
        condition="user_starts_workflow",
    )
    assert node.kind == "trigger"
    assert node.trigger_type == "manual"


def test_skill_node():
    skill_id = uuid.uuid4()
    employee_id = uuid.uuid4()
    node = SkillNode(
        skill_id=skill_id,
        employee_id=employee_id,
        inputs={"text": "input"},
    )
    assert node.kind == "skill"
    assert node.skill_id == skill_id


def test_condition_node():
    true_id = uuid.uuid4()
    false_id = uuid.uuid4()
    node = ConditionNode(
        expression="score > 0.8",
        true_next=true_id,
        false_next=false_id,
    )
    assert node.kind == "condition"
    assert node.true_next == true_id


def test_loop_node():
    body_id = uuid.uuid4()
    node = LoopNode(
        iterator_expr="items",
        body_node_ids=[body_id],
    )
    assert node.kind == "loop"
    assert len(node.body_node_ids) == 1


def test_human_approval_node():
    node = HumanApprovalNode(
        decision_type="execution",
        message_template="Approve sending email to {recipient}?",
    )
    assert node.kind == "human_approval"
    assert node.decision_type == "execution"


def test_human_node():
    emp_id = uuid.uuid4()
    node = HumanNode(
        employee_id=emp_id,
        input_protocol={"task_template": "Review {document}"},
        output_protocol={"format": "text"},
        timeout=3600,
        timeout_strategy="escalate",
    )
    assert node.kind == "human"
    assert node.timeout == 3600


def test_parallel_node():
    branch_a = uuid.uuid4()
    branch_b = uuid.uuid4()
    node = ParallelNode(
        branch_node_ids=[branch_a, branch_b],
        aggregation_strategy="wait_all",
    )
    assert node.kind == "parallel"
    assert len(node.branch_node_ids) == 2


def test_end_node():
    node = EndNode(
        output_mapping={"result": "$.output"},
    )
    assert node.kind == "end"


def test_workflow_edge():
    source = uuid.uuid4()
    target = uuid.uuid4()
    edge = WorkflowEdge(
        source_node_id=source,
        target_node_id=target,
    )
    assert edge.source_node_id == source
    assert edge.condition is None


def test_workflow_edge_with_condition():
    source = uuid.uuid4()
    target = uuid.uuid4()
    edge = WorkflowEdge(
        source_node_id=source,
        target_node_id=target,
        condition="approved == true",
    )
    assert edge.condition == "approved == true"


def test_workflow_creation():
    proj_id = uuid.uuid4()
    trigger = TriggerNode(trigger_type="manual", condition="start")
    skill = SkillNode(
        skill_id=uuid.uuid4(),
        employee_id=uuid.uuid4(),
    )
    end = EndNode(output_mapping={})

    wf = Workflow(
        project_id=proj_id,
        name="Test Workflow",
        kind="team",
        nodes=[trigger, skill, end],
        edges=[
            WorkflowEdge(source_node_id=trigger.id, target_node_id=skill.id),
            WorkflowEdge(source_node_id=skill.id, target_node_id=end.id),
        ],
    )
    assert wf.name == "Test Workflow"
    assert wf.kind == "team"
    assert len(wf.nodes) == 3
    assert len(wf.edges) == 2
    assert wf.version == 1


def test_workflow_discriminated_union_deserialization():
    from pydantic import TypeAdapter

    node_data = {"kind": "trigger", "trigger_type": "manual", "condition": "start"}
    adapter = TypeAdapter(WorkflowNode)
    node = adapter.validate_python(node_data)
    assert isinstance(node, TriggerNode)
    assert node.trigger_type == "manual"


def test_workflow_composite_skill_kind():
    proj_id = uuid.uuid4()
    wf = Workflow(
        project_id=proj_id,
        name="Composite Skill",
        kind="composite_skill",
        nodes=[TriggerNode(trigger_type="manual", condition="start")],
        edges=[],
    )
    assert wf.kind == "composite_skill"


def test_workflow_invalid_kind():
    proj_id = uuid.uuid4()
    with pytest.raises(ValidationError):
        Workflow(
            project_id=proj_id,
            name="Bad",
            kind="invalid",
            nodes=[],
            edges=[],
        )


def test_all_node_types_have_id():
    nodes = [
        TriggerNode(trigger_type="manual", condition="start"),
        SkillNode(skill_id=uuid.uuid4(), employee_id=uuid.uuid4()),
        ConditionNode(expression="x > 0", true_next=uuid.uuid4(), false_next=uuid.uuid4()),
        LoopNode(iterator_expr="items", body_node_ids=[uuid.uuid4()]),
        HumanApprovalNode(decision_type="execution", message_template="Approve?"),
        HumanNode(employee_id=uuid.uuid4()),
        ParallelNode(branch_node_ids=[uuid.uuid4()], aggregation_strategy="wait_all"),
        EndNode(output_mapping={}),
    ]
    for node in nodes:
        assert node.id is not None
        assert node.name is not None
