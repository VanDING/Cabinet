from uuid import uuid4

from cabinet.core.workflow.visualizer import WorkflowVisualizer
from cabinet.models.workflows import (
    EndNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowEdge,
)


def test_visualizer_generates_mermaid():
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="test",
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
    viz = WorkflowVisualizer()
    result = viz.to_mermaid(workflow)
    assert "graph TD" in result
    assert "trigger" in result.lower() or "TriggerNode" in result
    assert "skill" in result.lower() or "SkillNode" in result
    assert "end" in result.lower() or "EndNode" in result
    assert "-->" in result


def test_visualizer_generates_json():
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="test",
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
    viz = WorkflowVisualizer()
    result = viz.to_json(workflow)
    assert "nodes" in result
    assert "edges" in result
