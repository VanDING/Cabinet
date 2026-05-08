from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4


class MemoryType(str, Enum):
    USER = "user"
    FEEDBACK = "feedback"
    PROJECT = "project"
    REFERENCE = "reference"


MEMORY_TYPE_DIRS: dict[MemoryType, str] = {
    MemoryType.USER: "user",
    MemoryType.FEEDBACK: "feedback",
    MemoryType.PROJECT: "project",
    MemoryType.REFERENCE: "reference",
}


@dataclass
class MemoryEntry:
    memory_type: MemoryType
    name: str
    content: str
    entry_id: str = field(default_factory=lambda: uuid4().hex[:12])
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @classmethod
    def from_frontmatter(cls, raw: str, memory_type: MemoryType, filename: str) -> MemoryEntry:
        import re
        import yaml

        fm_match = re.search(r"^---\s*\n(.*?)\n---", raw, re.DOTALL | re.MULTILINE)
        metadata = {}
        if fm_match:
            metadata = yaml.safe_load(fm_match.group(1)) or {}
        body = raw[fm_match.end():].strip() if fm_match else raw.strip()
        name = metadata.get("name", filename.replace(".md", "").replace("_", " ").title())
        return cls(
            memory_type=memory_type,
            name=name,
            content=body,
        )

    def to_frontmatter(self) -> str:
        import yaml

        frontmatter = {
            "name": self.name,
            "description": self.content[:120].replace("\n", " "),
            "type": self.memory_type.value,
        }
        yaml_str = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False).strip()
        return f"---\n{yaml_str}\n---\n\n{self.content}\n"


@dataclass
class UserProfile:
    captain_id: str
    user_memories: list[MemoryEntry] = field(default_factory=list)
    feedback_memories: list[MemoryEntry] = field(default_factory=list)
    project_memories: list[MemoryEntry] = field(default_factory=list)
    reference_memories: list[MemoryEntry] = field(default_factory=list)

    def format_for_prompt(self) -> str:
        sections = []
        if self.user_memories:
            sections.append("## User Profile\n" + "\n".join(
                f"- {m.content[:300]}" for m in self.user_memories
            ))
        if self.feedback_memories:
            sections.append("## Work Preferences\n" + "\n".join(
                f"- {m.content[:300]}" for m in self.feedback_memories
            ))
        if self.project_memories:
            sections.append("## Project Context\n" + "\n".join(
                f"- {m.content[:300]}" for m in self.project_memories
            ))
        if self.reference_memories:
            sections.append("## Reference Pointers\n" + "\n".join(
                f"- {m.content[:200]}" for m in self.reference_memories
            ))
        return "\n\n".join(sections)
