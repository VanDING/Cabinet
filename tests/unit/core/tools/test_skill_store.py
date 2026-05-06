import os

import pytest

from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.tools.skill_store import SkillStore


@pytest.fixture
def skills_dir(tmp_path):
    d = tmp_path / "skills"
    d.mkdir()
    return str(d)


@pytest.fixture
def registry():
    return LocalToolRegistry()


@pytest.fixture
def store(skills_dir):
    return SkillStore(skills_dir=skills_dir)


@pytest.mark.asyncio
async def test_initialize_empty_dir(store, registry):
    await store.initialize(registry)
    skills = await registry.list_skills()
    assert skills == []


@pytest.mark.asyncio
async def test_initialize_loads_md_files(store, registry, skills_dir):
    skill_content = "\n---\nname: test_skill\ndescription: A test skill\ninput_schema:\n  type: object\noutput_schema:\n  type: object\n---\n\nProcess the following: {input}\n"
    with open(os.path.join(skills_dir, "test_skill.md"), "w") as f:
        f.write(skill_content)
    await store.initialize(registry)
    skills = await registry.list_skills()
    assert len(skills) == 1
    assert skills[0].name == "test_skill"


@pytest.mark.asyncio
async def test_load_skill_from_path(store, registry, skills_dir, tmp_path):
    skill_file = tmp_path / "external.md"
    skill_file.write_text("\n---\nname: external_skill\ndescription: External\ninput_schema:\n  type: object\noutput_schema:\n  type: object\n---\n\nDo something\n")
    skill = await store.load_skill(str(skill_file), registry)
    assert skill.name == "external_skill"
    skills = await registry.list_skills()
    assert len(skills) == 1
    assert os.path.exists(os.path.join(skills_dir, "external.md"))


@pytest.mark.asyncio
async def test_initialize_skips_non_md_files(store, registry, skills_dir):
    with open(os.path.join(skills_dir, "readme.txt"), "w") as f:
        f.write("not a skill")
    await store.initialize(registry)
    skills = await registry.list_skills()
    assert skills == []
