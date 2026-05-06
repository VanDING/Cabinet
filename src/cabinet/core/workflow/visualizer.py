from __future__ import annotations

import json
from uuid import UUID

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
    WorkflowNode,
)


class WorkflowVisualizer:
    def to_mermaid(self, workflow: Workflow) -> str:
        lines = ["graph TD"]
        node_labels = {}

        for node in workflow.nodes:
            label = self._node_label(node)
            shape = self._node_shape(node)
            node_id = self._safe_id(node.id)
            node_labels[node.id] = node_id
            if shape == "round":
                lines.append(f"    {node_id}({label})")
            elif shape == "diamond":
                lines.append(f"    {node_id}{{{label}}}")
            elif shape == "stadium":
                lines.append(f"    {node_id}([{label}])")
            else:
                lines.append(f"    {node_id}[{label}]")

        for edge in workflow.edges:
            src = node_labels.get(edge.source_node_id, str(edge.source_node_id)[:8])
            tgt = node_labels.get(edge.target_node_id, str(edge.target_node_id)[:8])
            label = f"|{edge.condition}|" if edge.condition else ""
            lines.append(f"    {src} -->{label} {tgt}")

        return "\n".join(lines)

    def to_json(self, workflow: Workflow) -> str:
        data = {
            "nodes": [
                {
                    "id": str(n.id),
                    "kind": n.kind,
                    "name": n.name,
                }
                for n in workflow.nodes
            ],
            "edges": [
                {
                    "source": str(e.source_node_id),
                    "target": str(e.target_node_id),
                    "condition": e.condition,
                }
                for e in workflow.edges
            ],
        }
        return json.dumps(data, indent=2)

    @staticmethod
    def _node_label(node: WorkflowNode) -> str:
        if isinstance(node, TriggerNode):
            return f"Trigger: {node.trigger_type}"
        if isinstance(node, SkillNode):
            return f"Skill: {node.name}"
        if isinstance(node, ConditionNode):
            return f"Condition: {node.expression[:20]}"
        if isinstance(node, LoopNode):
            return f"Loop: {node.loop_type}"
        if isinstance(node, HumanApprovalNode):
            return f"Approval: {node.decision_type}"
        if isinstance(node, HumanNode):
            return f"Human: {node.name}"
        if isinstance(node, ParallelNode):
            return f"Parallel: {len(node.branch_node_ids)} branches"
        if isinstance(node, EndNode):
            return "End"
        return node.name

    @staticmethod
    def _node_shape(node: WorkflowNode) -> str:
        if isinstance(node, TriggerNode):
            return "stadium"
        if isinstance(node, EndNode):
            return "stadium"
        if isinstance(node, ConditionNode):
            return "diamond"
        return "round"

    @staticmethod
    def _safe_id(node_id: UUID) -> str:
        return f"n{str(node_id)[:8]}"
