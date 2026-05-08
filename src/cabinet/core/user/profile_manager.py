from __future__ import annotations

import logging
import time
from pathlib import Path

from cabinet.core.user.models import MemoryType, MemoryEntry, UserProfile, MEMORY_TYPE_DIRS

logger = logging.getLogger(__name__)

MAX_INDEX_ENTRIES = 200
MAX_MEMORY_SIZE = 25_000


class UserProfileManager:
    def __init__(self, data_dir: str | Path):
        self._data_dir = Path(data_dir)
        for mtype in MemoryType:
            (self._data_dir / MEMORY_TYPE_DIRS[mtype]).mkdir(parents=True, exist_ok=True)
        self._index_path = self._data_dir / "MEMORY.md"

    def save(self, entry: MemoryEntry) -> None:
        entry.updated_at = time.time()
        if not entry.created_at:
            entry.created_at = entry.updated_at

        dir_path = self._data_dir / MEMORY_TYPE_DIRS[entry.memory_type]
        filename = self._safe_filename(entry.name) + ".md"
        filepath = dir_path / filename

        content = entry.to_frontmatter()
        if len(content) > MAX_MEMORY_SIZE:
            content = content[:MAX_MEMORY_SIZE]
            logger.warning("Memory truncated to %d chars: %s", MAX_MEMORY_SIZE, entry.name)

        filepath.write_text(content, encoding="utf-8")
        self._update_index(entry)
        logger.debug("Saved memory: %s/%s", entry.memory_type.value, entry.name)

    def load_all(self, memory_type: MemoryType) -> list[MemoryEntry]:
        dir_path = self._data_dir / MEMORY_TYPE_DIRS[memory_type]
        if not dir_path.exists():
            return []
        entries = []
        for filepath in sorted(dir_path.glob("*.md")):
            try:
                raw = filepath.read_text(encoding="utf-8")
                entry = MemoryEntry.from_frontmatter(
                    raw, memory_type, filepath.stem
                )
                stat = filepath.stat()
                entry.created_at = stat.st_ctime
                entry.updated_at = stat.st_mtime
                entries.append(entry)
            except Exception as e:
                logger.error("Failed to load memory %s: %s", filepath, e)
        return entries

    def delete(self, memory_type: MemoryType, name: str) -> bool:
        dir_path = self._data_dir / MEMORY_TYPE_DIRS[memory_type]
        filename = self._safe_filename(name) + ".md"
        filepath = dir_path / filename
        if filepath.exists():
            filepath.unlink()
            self._rebuild_index()
            logger.info("Deleted memory: %s/%s", memory_type.value, name)
            return True
        return False

    def build_profile(self, captain_id: str) -> UserProfile:
        return UserProfile(
            captain_id=captain_id,
            user_memories=self.load_all(MemoryType.USER),
            feedback_memories=self.load_all(MemoryType.FEEDBACK),
            project_memories=self.load_all(MemoryType.PROJECT),
            reference_memories=self.load_all(MemoryType.REFERENCE),
        )

    def list_index(self) -> dict[str, list[dict]]:
        result: dict[str, list[dict]] = {
            "user": [], "feedback": [], "project": [], "reference": [],
        }
        if not self._index_path.exists():
            return result
        for line in self._index_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("- [") and "](" in line:
                for mtype in MemoryType:
                    key = MEMORY_TYPE_DIRS[mtype]
                    if f"]({key}/" in line or f"]({mtype.value}/" in line:
                        name = line.split("[")[1].split("]")[0] if "[" in line else "unknown"
                        result[mtype.value].append({"line": line, "name": name})
        return result

    def _update_index(self, entry: MemoryEntry) -> None:
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        lines = []
        for mtype in MemoryType:
            entries = self.load_all(mtype)
            for entry in entries:
                dir_name = MEMORY_TYPE_DIRS[mtype]
                filename = self._safe_filename(entry.name) + ".md"
                hook = entry.content[:100].replace("\n", " ")
                lines.append(f"- [{entry.name}]({dir_name}/{filename}) — {hook}")
        if len(lines) > MAX_INDEX_ENTRIES:
            lines = lines[:MAX_INDEX_ENTRIES]
            logger.warning("Memory index truncated to %d entries", MAX_INDEX_ENTRIES)
        self._index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    @staticmethod
    def _safe_filename(name: str) -> str:
        import re
        safe = re.sub(r"[^\w\s-]", "", name.lower())
        safe = re.sub(r"[-\s]+", "-", safe)
        return safe.strip("-")[:64] or "unnamed"
