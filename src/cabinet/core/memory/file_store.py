from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

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
