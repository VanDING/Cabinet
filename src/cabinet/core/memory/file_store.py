from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from cabinet.models.primitives import MemoryItem, MemoryScope
from uuid import uuid4

logger = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


@dataclass
class FileMemoryItem:
    name: str
    description: str
    type: str
    content: str
    filepath: Path | None = None

    @classmethod
    def from_file(cls, path: Path) -> FileMemoryItem:
        text = path.read_text(encoding="utf-8")
        m = FRONTMATTER_RE.match(text)
        if m:
            meta = yaml.safe_load(m.group(1)) or {}
            body = text[m.end():]
        else:
            meta = {}
            body = text
        return cls(
            name=meta.get("name", path.stem),
            description=meta.get("description", ""),
            type=meta.get("type", path.parent.name),
            content=body.strip(),
            filepath=path,
        )

    def to_markdown(self) -> str:
        frontmatter = yaml.dump(
            {
                "name": self.name,
                "description": self.description,
                "type": self.type,
            },
            allow_unicode=True,
        ).strip()
        return f"---\n{frontmatter}\n---\n\n{self.content}"


class FileMemoryStore:
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)

    def store(self, item: FileMemoryItem) -> Path:
        dir_path = self.base_dir / item.type
        dir_path.mkdir(parents=True, exist_ok=True)
        filepath = dir_path / f"{item.name}.md"
        filepath.write_text(item.to_markdown(), encoding="utf-8")
        self._rebuild_index()
        return filepath

    def list_headers(self) -> list[dict]:
        headers: list[dict] = []
        if not self.base_dir.exists():
            return headers
        for md_file in sorted(self.base_dir.glob("**/*.md")):
            if md_file.name == "MEMORY.md":
                continue
            try:
                item = FileMemoryItem.from_file(md_file)
                headers.append({
                    "name": item.name,
                    "description": item.description,
                    "type": item.type,
                    "filepath": str(md_file),
                })
            except Exception:
                logger.debug("Failed to parse memory file: %s", md_file, exc_info=True)
                continue
        return headers

    def get(self, name: str, type: str) -> FileMemoryItem | None:
        filepath = self.base_dir / type / f"{name}.md"
        if not filepath.exists():
            return None
        return FileMemoryItem.from_file(filepath)

    def delete(self, name: str, type: str) -> None:
        filepath = self.base_dir / type / f"{name}.md"
        if filepath.exists():
            filepath.unlink()
            self._rebuild_index()

    def _rebuild_index(self) -> None:
        headers = self.list_headers()
        lines = ["# Memory Index\n"]
        for h in headers:
            lines.append(
                f"- [{h['name']}]({h['type']}/{h['name']}.md) — {h['description']}"
            )
        index_path = self.base_dir / "MEMORY.md"
        index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ── MemoryStore protocol async methods ──

    async def initialize(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        pass

    async def store(self, item) -> None:
        """Store a MemoryItem as a YAML frontmatter .md file."""
        from uuid import uuid4 as _uuid4
        file_item = FileMemoryItem(
            name=item.id.hex if hasattr(item.id, 'hex') else str(item.id)[:8],
            description=item.metadata.get("description", "") if item.metadata else "",
            type=item.scope.value if hasattr(item.scope, 'value') else str(item.scope),
            content=item.content,
        )
        self._store_sync(file_item)

    async def search(self, query: str, scope=None, limit: int = 5) -> list:
        """Search .md files in scope directory for query substring match."""
        from cabinet.models.primitives import MemoryItem, MemoryScope
        from uuid import uuid4

        scope_str = scope.value if hasattr(scope, 'value') else str(scope) if scope else "long_term"
        scope_dir = self.base_dir / scope_str
        results = []
        if scope_dir.exists():
            for md_file in sorted(scope_dir.glob("*.md")):
                if md_file.name == "MEMORY.md":
                    continue
                try:
                    content = md_file.read_text(encoding="utf-8")
                    if query.lower() in content.lower():
                        item = FileMemoryItem.from_file(md_file)
                        results.append(MemoryItem(
                            id=uuid4(),
                            owner_id=item.type,
                            scope=MemoryScope.LONG_TERM,
                            content=item.content,
                            metadata={
                                "filepath": str(md_file),
                                "name": item.name,
                                "description": item.description,
                                "type": item.type,
                            },
                        ))
                except Exception:
                    continue
        return results[:limit]

    async def retrieve(self, memory_id: str) -> None | object:
        """Search all scope directories for matching filename stem."""
        from cabinet.models.primitives import MemoryItem, MemoryScope
        from uuid import uuid4

        if not self.base_dir.exists():
            return None
        for scope_dir in self.base_dir.iterdir():
            if not scope_dir.is_dir():
                continue
            for md_file in scope_dir.glob("*.md"):
                if memory_id in md_file.stem:
                    item = FileMemoryItem.from_file(md_file)
                    return MemoryItem(
                        id=uuid4(),
                        owner_id=item.type,
                        scope=MemoryScope.LONG_TERM,
                        content=item.content,
                        metadata={"filepath": str(md_file), "name": item.name},
                    )
        return None

    async def delete(self, memory_id: str) -> None:
        """Delete .md file matching the memory_id in any scope directory."""
        if not self.base_dir.exists():
            return
        for scope_dir in self.base_dir.iterdir():
            if not scope_dir.is_dir():
                continue
            for md_file in scope_dir.glob("*.md"):
                if memory_id in md_file.stem:
                    md_file.unlink()
                    return

    def _store_sync(self, file_item) -> None:
        """Internal sync store used by the async store wrapper."""
        dir_path = self.base_dir / file_item.type
        dir_path.mkdir(parents=True, exist_ok=True)
        filepath = dir_path / f"{file_item.name}.md"
        filepath.write_text(file_item.to_markdown(), encoding="utf-8")
        self._rebuild_index()
