from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml

from cabinet.models.primitives import SkillDefinition


@dataclass
class SkillMetadata:
    name: str = "unnamed"
    description: str = ""
    version: str = "0.1.0"
    author: str = ""
    license: str = "MIT"
    category: str = "general"
    platforms: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    related_skills: list[str] = field(default_factory=list)
    config: dict = field(default_factory=dict)


class SkillLoader:
    def parse_file(self, path: str) -> SkillDefinition:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return self._parse_content(content)

    def parse_dict(
        self,
        name: str,
        description: str,
        input_schema: dict,
        output_schema: dict,
        prompt_template: str | None = None,
        requires_knowledge: list | None = None,
        requires_human_approval: bool = False,
    ) -> SkillDefinition:
        return SkillDefinition(
            name=name,
            description=description,
            kind="atomic",
            input_schema=input_schema,
            output_schema=output_schema,
            prompt_template=prompt_template,
            requires_knowledge=requires_knowledge or [],
            requires_human_approval=requires_human_approval,
        )

    def parse_metadata(self, path: str) -> SkillMetadata:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        frontmatter_match = re.search(r"^---\s*\n(.*?)\n---", content, re.DOTALL | re.MULTILINE)
        if not frontmatter_match:
            return SkillMetadata()
        data = yaml.safe_load(frontmatter_match.group(1)) or {}
        return SkillMetadata(**{
            k: v for k, v in data.items()
            if k in SkillMetadata.__dataclass_fields__
        })

    def _parse_content(self, content: str) -> SkillDefinition:
        frontmatter_match = re.search(r"^---\s*\n(.*?)\n---", content, re.DOTALL | re.MULTILINE)
        if frontmatter_match:
            metadata = yaml.safe_load(frontmatter_match.group(1))
            body = content[frontmatter_match.end() :].strip()
        else:
            metadata = {}
            body = content.strip()

        name = metadata.get("name", "unnamed")
        if name == "unnamed":
            title_match = re.search(r"^#\s+(.+)", content)
            if title_match:
                name = title_match.group(1).strip()

        return SkillDefinition(
            name=name,
            description=metadata.get("description", ""),
            kind="atomic",
            input_schema=metadata.get("input_schema", {"type": "object"}),
            output_schema=metadata.get("output_schema", {"type": "object"}),
            prompt_template=body if body else None,
            requires_human_approval=metadata.get("requires_human_approval", False),
        )
