from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from cabinet.core.designer.generator import WorkflowGenerator
from cabinet.models.pipes import Pipe


@pytest.fixture
def mock_gateway():
    gw = AsyncMock()
    gw.complete.return_value.content = """```json
{
  "workflow": {
    "name": "招聘流程",
    "nodes": [
      {"id": "n1", "kind": "trigger", "name": "start", "trigger_type": "manual"},
      {"id": "n2", "kind": "skill", "name": "简历解析", "skill_id": "s1", "employee_id": "e1", "inputs": {}},
      {"id": "n3", "kind": "end", "name": "end"}
    ],
    "edges": [
      {"source_node_id": "n1", "target_node_id": "n2"},
      {"source_node_id": "n2", "target_node_id": "n3"}
    ]
  },
  "pipes": [
    {
      "name": "简历解析管道",
      "description": "解析并结构化简历信息",
      "kind": "atomic",
      "system_prompt": "你是一个专业的简历解析助手",
      "reasoning": {"temperature": 0.2}
    }
  ]
}
```"""
    return gw


@pytest.fixture
def generator(mock_gateway):
    return WorkflowGenerator(gateway=mock_gateway)


@pytest.mark.asyncio
async def test_generate_returns_workflow_and_pipes(generator):
    workflow, pipes = await generator.generate("搭建招聘流程")
    assert workflow["name"] == "招聘流程"
    assert len(workflow["nodes"]) == 3
    assert len(workflow["edges"]) == 2
    assert len(pipes) == 1
    assert pipes[0]["name"] == "简历解析管道"
    assert pipes[0]["reasoning"]["temperature"] == 0.2


@pytest.mark.asyncio
async def test_generate_with_templates_as_few_shot(generator):
    templates = [
        Pipe(
            name="HR标准流程",
            description="标准招聘",
            kind="atomic",
            system_prompt="招聘管理助手",
        ),
    ]
    workflow, pipes = await generator.generate("搭建招聘流程", templates=templates)
    assert workflow is not None
    assert len(pipes) >= 1
    call_args = generator._gateway.complete.call_args
    messages = call_args[1]["messages"]
    prompt_text = messages[1]["content"]
    assert "HR标准流程" in prompt_text


@pytest.mark.asyncio
async def test_generate_handles_bad_json(generator):
    generator._gateway.complete.return_value.content = "not valid json at all"
    workflow, pipes = await generator.generate("test")
    assert workflow["nodes"] == []
    assert pipes == []


@pytest.mark.asyncio
async def test_generate_sets_draft_status(generator):
    workflow, pipes = await generator.generate("test")
    assert workflow is not None
    assert isinstance(workflow, dict)
    assert isinstance(pipes, list)
