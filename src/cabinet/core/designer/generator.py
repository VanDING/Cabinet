from __future__ import annotations

import json
import re

from cabinet.models.pipes import Pipe

GENERATOR_SYSTEM_PROMPT = """你是 Cabinet Designer，负责将用户的需求描述转换为工作流和管道配置。

输出格式必须是 JSON：
{
  "workflow": {
    "name": "工作流名称",
    "nodes": [
      {"id": "n1", "kind": "trigger", "name": "开始", "trigger_type": "manual"},
      {"id": "n2", "kind": "skill", "name": "步骤名", "skill_id": "s1", "employee_id": "e1", "inputs": {}},
      {"id": "n3", "kind": "end", "name": "结束"}
    ],
    "edges": [
      {"source_node_id": "n1", "target_node_id": "n2"},
      {"source_node_id": "n2", "target_node_id": "n3"}
    ]
  },
  "pipes": [
    {
      "name": "管道名称",
      "description": "管道描述",
      "kind": "atomic",
      "system_prompt": "角色的 system prompt",
      "reasoning": {"temperature": 0.3, "chain_of_thought": false}
    }
  ]
}

规则：
1. 每个工作流必须有 trigger 节点和 end 节点
2. 每个 skill 节点对应一个独立的管道
3. 每个管道必须有清晰的 system_prompt
4. 为每个管道设置合理的 reasoning 参数"""


class WorkflowGenerator:
    """LLM-based workflow and pipe generator.

    Uses a ModelGateway to call an LLM that generates workflow DAGs and pipe
    configurations from natural language descriptions. Templates (Pipe objects)
    can be passed as few-shot examples to improve generation quality.
    """

    def __init__(self, gateway):
        self._gateway = gateway

    async def generate(
        self, description: str, templates: list[Pipe] | None = None
    ) -> tuple[dict, list[dict]]:
        user_prompt = f"请为以下需求设计工作流和管道配置：\n\n{description}\n\n"
        if templates:
            user_prompt += "参考以下现有模板作为样例：\n"
            for t in templates:
                user_prompt += f"- {t.name}: {t.description}\n"
                user_prompt += f"  System Prompt: {t.system_prompt[:200]}\n"

        user_prompt += "\n请返回 JSON 格式的工作流和管道配置。"

        try:
            response = await self._gateway.complete(
                messages=[
                    {"role": "system", "content": GENERATOR_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                model="default",
                temperature=0.3,
            )
            return self._parse_response(response.content)
        except Exception:
            return {"nodes": [], "edges": [], "name": description}, []

    @staticmethod
    def _parse_response(content: str) -> tuple[dict, list[dict]]:
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            brace_start = content.find("{")
            brace_end = content.rfind("}")
            if brace_start >= 0 and brace_end > brace_start:
                json_str = content[brace_start : brace_end + 1]
            else:
                return {"nodes": [], "edges": [], "name": "parse_error"}, []

        try:
            data = json.loads(json_str)
            workflow = data.get("workflow", {"nodes": [], "edges": []})
            pipes = data.get("pipes", [])
            return workflow, pipes
        except json.JSONDecodeError:
            return {"nodes": [], "edges": [], "name": "parse_error"}, []
