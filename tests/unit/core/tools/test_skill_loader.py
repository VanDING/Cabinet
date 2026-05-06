import os

import pytest

from cabinet.core.tools.skill_loader import SkillLoader


@pytest.fixture
def loader():
    return SkillLoader()


def test_parse_skill_md(loader):
    sample_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..",
        "src", "cabinet", "core", "tools", "samples", "hello_world.md"
    )
    if not os.path.exists(sample_path):
        pytest.skip("Sample SKILL.md not found")

    skill = loader.parse_file(sample_path)
    assert skill.name == "hello_world"
    assert skill.kind == "atomic"
    assert "name" in skill.input_schema.get("properties", {})
    assert skill.prompt_template is not None
    assert "{name}" in skill.prompt_template


def test_parse_skill_from_dict(loader):
    skill = loader.parse_dict(
        name="summarizer",
        description="Summarizes text",
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"summary": {"type": "string"}}},
        prompt_template="Summarize: {text}",
    )
    assert skill.name == "summarizer"
    assert skill.prompt_template == "Summarize: {text}"
