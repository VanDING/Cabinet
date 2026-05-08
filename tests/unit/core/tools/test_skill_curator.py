from __future__ import annotations

from cabinet.core.tools.skill_loader import SkillLoader
from cabinet.core.tools.skill_curator import SkillCurator


class TestSKILLmdParsing:
    def test_parse_skill_with_full_frontmatter(self):
        content = """---
name: code-review
description: Review code changes for quality and security
version: "1.2.0"
author: Cabinet Team
license: MIT
category: devops
platforms:
  - linux
  - macos
tags:
  - review
  - security
---

# Code Review Skill

Review changed files for bugs, security issues, and style violations.
"""
        loader = SkillLoader()
        skill = loader._parse_content(content)

        assert skill.name == "code-review"
        assert skill.description == "Review code changes for quality and security"

    def test_parse_skill_with_minimal_frontmatter(self):
        content = """---
name: hello
---
Say hello to the user.
"""
        loader = SkillLoader()
        skill = loader._parse_content(content)
        assert skill.name == "hello"
        assert skill.prompt_template == "Say hello to the user."


class TestSkillCurator:
    async def test_register_and_list_skills(self, tmp_path):
        curator = SkillCurator(skills_dir=tmp_path)
        await curator.register_skill("code-review", "builtin")
        assert "code-review" in curator.list_skills()

    async def test_record_use_increments_counter(self, tmp_path):
        curator = SkillCurator(skills_dir=tmp_path)
        await curator.register_skill("code-review", "builtin")
        await curator.record_use("code-review")
        await curator.record_use("code-review")
        info = curator.get_skill_info("code-review")
        assert info["use_count"] == 2

    async def test_review_suggests_improvement_after_enough_uses(self, tmp_path):
        curator = SkillCurator(skills_dir=tmp_path)
        await curator.register_skill("code-review", "builtin")
        for _ in range(4):
            await curator.record_use("code-review")
        result = await curator.review_and_improve("code-review")
        assert result is not None
        assert "4 times" in result
