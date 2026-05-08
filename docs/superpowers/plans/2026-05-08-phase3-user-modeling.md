# Phase 3: User Modeling System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-session user modeling system that learns user preferences, role, work style, and project context over time. Implements the four memory types from Claude Code (user, feedback, project, reference) with the Honcho-inspired dialectic profiling approach. Integrates with existing MemoryOrchestrator/MemoryScorer so user context is automatically injected into future sessions.

**Architecture:** Three new classes. `UserProfileManager` manages the four memory types with file-based persistence (MEMORY.md index + individual `.md` files) following the same pattern as Claude Code's memory system. `UserProfileInjector` builds the user-specific prompt injection at session start by querying the profile store and formatting context. `UserModelLearner` observes conversation patterns (corrections, confirmations, questions) and suggests memory updates. Integrates into `CabinetRuntime` for automatic injection.

**Tech Stack:** Python 3.12+, PyYAML (frontmatter parsing), aiosqlite (profile index), existing memory system (MemoryOrchestrator, MemoryScorer)

---

## File Structure

```
src/cabinet/core/
├── user/                              # NEW sub-module
│   ├── __init__.py
│   ├── profile_manager.py             # UserProfileManager — CRUD for 4 memory types
│   ├── profile_injector.py            # UserProfileInjector — prompt assembly
│   ├── model_learner.py               # UserModelLearner — observation-based learning
│   └── models.py                      # MemoryEntry, MemoryType, UserProfile
├── memory/
│   └── orchestrator.py                # MODIFY — accept user profile during assembly
└── runtime.py                         # MODIFY — wire user profile system
tests/unit/core/user/
├── test_profile_manager.py            # NEW — 12 tests
├── test_profile_injector.py           # NEW — 6 tests
└── test_model_learner.py              # NEW — 8 tests
data/user/                             # NEW default directory (gitignored)
```

---

### Task 1: User Memory Models + Profile Manager

**Files:**
- Create: `src/cabinet/core/user/__init__.py`
- Create: `src/cabinet/core/user/models.py`
- Create: `src/cabinet/core/user/profile_manager.py`
- Test: `tests/unit/core/user/test_profile_manager.py`

- [ ] **Step 1: Write failing tests for UserProfileManager**

```python
from __future__ import annotations

from pathlib import Path

import pytest
from cabinet.core.user.models import MemoryType, MemoryEntry, UserProfile
from cabinet.core.user.profile_manager import UserProfileManager


class TestMemoryEntry:
    def test_user_memory_has_required_fields(self):
        entry = MemoryEntry(
            memory_type=MemoryType.USER,
            name="User Role",
            content="**Role:** Senior data scientist\n**Focus:** Observability and logging",
        )
        assert entry.memory_type == MemoryType.USER
        assert "Senior data scientist" in entry.content
        assert entry.name == "User Role"

    def test_feedback_memory_has_rule_format(self):
        entry = MemoryEntry(
            memory_type=MemoryType.FEEDBACK,
            name="No Mocks in Integration Tests",
            content="Integration tests must hit a real database, not mocks.\n"
                    "**Why:** Prior incident where mock/prod divergence masked broken migration.\n"
                    "**How to apply:** When writing tests in the integration/ directory.",
        )
        assert entry.memory_type == MemoryType.FEEDBACK
        assert "Why:" in entry.content
        assert "How to apply:" in entry.content


class TestUserProfileManager:
    def test_save_and_load_memory(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(
            memory_type=MemoryType.PROJECT,
            name="Merge Freeze",
            content="Merge freeze begins 2026-05-15 for mobile release cut.",
        )
        manager.save(entry)
        loaded = manager.load_all(MemoryType.PROJECT)
        assert len(loaded) == 1
        assert "Merge freeze" in loaded[0].content

    def test_list_all_returns_by_type(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        manager.save(MemoryEntry(memory_type=MemoryType.USER, name="Role", content="Data scientist"))
        manager.save(MemoryEntry(memory_type=MemoryType.FEEDBACK, name="Style", content="Terse responses"))
        manager.save(MemoryEntry(memory_type=MemoryType.PROJECT, name="Deadline", content="Q3 launch"))

        all_memories = manager.list_index()
        assert "user" in all_memories
        assert "feedback" in all_memories
        assert "project" in all_memories

    def test_update_existing_memory(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(
            memory_type=MemoryType.REFERENCE,
            name="Bug Tracker",
            content="Bugs tracked in Linear project INGEST",
        )
        manager.save(entry)

        updated = MemoryEntry(
            memory_type=MemoryType.REFERENCE,
            name="Bug Tracker",
            content="Bugs tracked in Jira project INGEST (migrated from Linear)",
        )
        manager.save(updated)

        loaded = manager.load_all(MemoryType.REFERENCE)
        assert len(loaded) == 1
        assert "Jira" in loaded[0].content

    def test_delete_memory(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(memory_type=MemoryType.PROJECT, name="Temp", content="Temporary note")
        manager.save(entry)
        assert len(manager.load_all(MemoryType.PROJECT)) == 1

        manager.delete(MemoryType.PROJECT, "Temp")
        assert len(manager.load_all(MemoryType.PROJECT)) == 0

    def test_memories_persist_across_manager_instances(self, tmp_path):
        manager1 = UserProfileManager(data_dir=tmp_path)
        manager1.save(MemoryEntry(memory_type=MemoryType.USER, name="Skills", content="Python expert"))

        manager2 = UserProfileManager(data_dir=tmp_path)
        loaded = manager2.load_all(MemoryType.USER)
        assert len(loaded) == 1
        assert "Python expert" in loaded[0].content

    def test_build_user_profile_aggregates_all_types(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        manager.save(MemoryEntry(memory_type=MemoryType.USER, name="Role", content="Backend engineer"))
        manager.save(MemoryEntry(memory_type=MemoryType.FEEDBACK, name="Pref1", content="No docstrings"))
        manager.save(MemoryEntry(memory_type=MemoryType.PROJECT, name="Context", content="Refactoring auth"))
        manager.save(MemoryEntry(memory_type=MemoryType.REFERENCE, name="Dashboard", content="grafana.internal"))

        profile = manager.build_profile("captain-1")
        assert profile.captain_id == "captain-1"
        assert len(profile.user_memories) == 1
        assert len(profile.feedback_memories) == 1
        assert len(profile.project_memories) == 1
        assert len(profile.reference_memories) == 1

    def test_memory_has_timestamp(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(memory_type=MemoryType.USER, name="Test", content="Content")
        manager.save(entry)
        loaded = manager.load_all(MemoryType.USER)
        assert loaded[0].created_at > 0
        assert loaded[0].updated_at >= loaded[0].created_at
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/user/test_profile_manager.py -v`
Expected: FAIL — no module

- [ ] **Step 3: Write models.py**

```python
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
```

- [ ] **Step 4: Write profile_manager.py**

```python
from __future__ import annotations

import json
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/unit/core/user/test_profile_manager.py -v`
Expected: 8 PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/user/ tests/unit/core/user/
git commit -m "feat(user): add UserProfileManager with four memory types and frontmatter-based persistence"
```

---

### Task 2: UserProfileInjector — Prompt Assembly

**Files:**
- Create: `src/cabinet/core/user/profile_injector.py`
- Modify: `src/cabinet/core/memory/orchestrator.py`
- Test: `tests/unit/core/user/test_profile_injector.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from cabinet.core.user.models import MemoryType, MemoryEntry
from cabinet.core.user.profile_manager import UserProfileManager
from cabinet.core.user.profile_injector import UserProfileInjector


class TestProfileInjector:
    @pytest.fixture
    def manager(self, tmp_path):
        mgr = UserProfileManager(data_dir=tmp_path)
        mgr.save(MemoryEntry(
            memory_type=MemoryType.USER,
            name="Role",
            content="Senior backend engineer with 10 years Go experience",
        ))
        mgr.save(MemoryEntry(
            memory_type=MemoryType.FEEDBACK,
            name="Style",
            content="Prefer terse responses. No emoji. No trailing summaries.",
        ))
        mgr.save(MemoryEntry(
            memory_type=MemoryType.PROJECT,
            name="Auth Migration",
            content="Auth middleware rewrite driven by legal/compliance requirements for session token storage.",
        ))
        return mgr

    def test_injector_builds_context(self, manager):
        injector = UserProfileInjector(manager)
        context = injector.build_context("captain-1")
        assert "Senior backend engineer" in context
        assert "terse responses" in context
        assert "Auth middleware" in context

    def test_injector_respects_max_tokens(self, manager):
        injector = UserProfileInjector(manager, max_tokens=50)
        context = injector.build_context("captain-1")
        assert len(context) <= 200  # ~50 tokens * 4 chars

    def test_empty_profile_produces_empty_context(self, tmp_path):
        empty_manager = UserProfileManager(data_dir=tmp_path)
        injector = UserProfileInjector(empty_manager)
        context = injector.build_context("unknown-captain")
        assert context == ""

    def test_injector_formats_for_system_prompt(self, manager):
        injector = UserProfileInjector(manager)
        prompt_section = injector.format_as_system_prompt("captain-1")
        assert "# User Profile" in prompt_section or "## User Profile" in prompt_section

    def test_injector_caches_profile_for_reuse(self, manager):
        injector = UserProfileInjector(manager, cache_ttl=300)
        ctx1 = injector.build_context("captain-1")
        ctx2 = injector.build_context("captain-1")
        assert ctx1 == ctx2  # cached

    def test_injector_refreshes_after_ttl(self, manager, tmp_path):
        injector = UserProfileInjector(manager, cache_ttl=-1)
        ctx1 = injector.build_context("captain-1")
        ctx2 = injector.build_context("captain-1")
        assert ctx1 == ctx2  # Should still work, just re-fetched
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/user/test_profile_injector.py -v`
Expected: FAIL

- [ ] **Step 3: Write profile_injector.py**

```python
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cabinet.core.user.profile_manager import UserProfileManager
    from cabinet.core.user.models import UserProfile

logger = logging.getLogger(__name__)


@dataclass
class UserProfileInjector:
    profile_manager: "UserProfileManager"
    max_tokens: int = 1000
    cache_ttl: float = 300.0
    _cache: dict[str, tuple[float, str]] = None

    def __post_init__(self):
        if self._cache is None:
            self._cache = {}

    def build_context(self, captain_id: str) -> str:
        now = time.monotonic()
        cached = self._cache.get(captain_id)
        if cached and (now - cached[0]) < self.cache_ttl:
            return cached[1]

        profile = self.profile_manager.build_profile(captain_id)
        context = profile.format_for_prompt()

        max_chars = self.max_tokens * 4
        if len(context) > max_chars:
            context = context[:max_chars]

        self._cache[captain_id] = (now, context)
        logger.debug("Built user profile context: %d chars for %s", len(context), captain_id)
        return context

    def format_as_system_prompt(self, captain_id: str) -> str:
        context = self.build_context(captain_id)
        if not context:
            return ""
        return f"""<user-profile>
The following information is known about the user from prior interactions:

{context}

Use this context to tailor your responses to the user's background, preferences, and current project.
</user-profile>"""

    def invalidate_cache(self, captain_id: str | None = None) -> None:
        if captain_id is None:
            self._cache.clear()
        else:
            self._cache.pop(captain_id, None)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/user/test_profile_injector.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/user/profile_injector.py tests/unit/core/user/test_profile_injector.py
git commit -m "feat(user): add UserProfileInjector for session-start prompt enrichment"
```

---

### Task 3: UserModelLearner — Observation-Based Learning

**Files:**
- Create: `src/cabinet/core/user/model_learner.py`
- Test: `tests/unit/core/user/test_model_learner.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from cabinet.core.user.models import MemoryType, MemoryEntry
from cabinet.core.user.profile_manager import UserProfileManager
from cabinet.core.user.model_learner import UserModelLearner, ConversationObservation


class TestUserModelLearner:
    @pytest.fixture
    def learner(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        return UserModelLearner(manager)

    def test_detect_correction_creates_feedback_memory(self, learner):
        obs = learner.analyze_interaction(
            user_message="No, don't write docstrings. I prefer inline comments.",
            assistant_response="Got it, I'll avoid docstrings.",
        )
        assert obs is not None
        assert obs.memory_type == MemoryType.FEEDBACK

    def test_detect_confirmation_reinforces_preference(self, learner):
        learner.analyze_interaction(
            user_message="Yes, exactly — the single bundled PR approach was right.",
            assistant_response="Noted.",
        )
        obs = learner.analyze_interaction(
            user_message="Same situation — bundle the PRs again please.",
            assistant_response="Will do.",
        )
        assert obs is not None

    def test_detect_explicit_remember(self, learner):
        obs = learner.analyze_interaction(
            user_message="Remember that our CI uses GitHub Actions with 4 workers.",
            assistant_response="I'll save that.",
        )
        assert obs is not None
        assert obs.memory_type in (MemoryType.REFERENCE, MemoryType.PROJECT)

    def test_no_observation_for_casual_chat(self, learner):
        obs = learner.analyze_interaction(
            user_message="What's the weather today?",
            assistant_response="I don't have access to weather data.",
        )
        assert obs is None

    def test_save_observation_persists_memory(self, learner):
        obs = ConversationObservation(
            memory_type=MemoryType.USER,
            name="Python Expert",
            content="User has 10 years Python experience. Frame explanations accordingly.",
            confidence=0.9,
        )
        learner.save_observation(obs)
        loaded = learner.manager.load_all(MemoryType.USER)
        assert len(loaded) == 1
        assert "10 years Python" in loaded[0].content

    def test_low_confidence_observations_not_saved(self, learner):
        obs = ConversationObservation(
            memory_type=MemoryType.USER,
            name="Maybe Expert",
            content="User might know Python",
            confidence=0.3,
        )
        learner.save_observation(obs)
        loaded = learner.manager.load_all(MemoryType.USER)
        assert len(loaded) == 0

    def test_detect_user_role_from_introduction(self, learner):
        obs = learner.analyze_interaction(
            user_message="I'm a data scientist working on our logging pipeline.",
            assistant_response="Great, I'll help with the logging pipeline.",
        )
        assert obs is not None
        assert obs.memory_type == MemoryType.USER
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/user/test_model_learner.py -v`
Expected: FAIL

- [ ] **Step 3: Write model_learner.py**

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from cabinet.core.user.models import MemoryType, MemoryEntry

if TYPE_CHECKING:
    from cabinet.core.user.profile_manager import UserProfileManager

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.6

CORRECTION_PATTERNS = [
    re.compile(r"\b(no|don't|never|stop|avoid)\b.*\b(do|use|write|say|call)\b", re.IGNORECASE),
    re.compile(r"not\s+that", re.IGNORECASE),
    re.compile(r"(wrong|incorrect|bad)\s+(approach|idea|way)", re.IGNORECASE),
]

CONFIRMATION_PATTERNS = [
    re.compile(r"\b(yes|exactly|right|correct|perfect|good|great)\b", re.IGNORECASE),
    re.compile(r"keep\s+(doing|using|writing)", re.IGNORECASE),
]

REMEMBER_PATTERNS = [
    re.compile(r"\b(remember|note|save)\s+(that|this)\b", re.IGNORECASE),
    re.compile(r"\bstore\s+this\b", re.IGNORECASE),
]

ROLE_PATTERNS = [
    re.compile(r"i('m| am)\s+a\s+(\w+[\s\w]*(?:engineer|developer|scientist|designer|manager|analyst|architect))", re.IGNORECASE),
]


@dataclass
class ConversationObservation:
    memory_type: MemoryType
    name: str
    content: str
    confidence: float = 0.7
    source_message: str = ""


class UserModelLearner:
    def __init__(self, profile_manager: "UserProfileManager", confidence_threshold: float = CONFIDENCE_THRESHOLD):
        self.manager = profile_manager
        self._threshold = confidence_threshold

    def analyze_interaction(
        self, user_message: str, assistant_response: str
    ) -> ConversationObservation | None:
        msg = user_message.strip()

        obs = self._detect_remember(msg)
        if obs:
            return obs

        obs = self._detect_role(msg)
        if obs:
            return obs

        obs = self._detect_correction(msg)
        if obs:
            return obs

        obs = self._detect_confirmation(msg)
        if obs:
            return obs

        return None

    def save_observation(self, obs: ConversationObservation) -> bool:
        if obs.confidence < self._threshold:
            logger.debug("Skipping low-confidence observation: %s (%.2f)", obs.name, obs.confidence)
            return False

        entry = MemoryEntry(
            memory_type=obs.memory_type,
            name=obs.name,
            content=obs.content,
        )
        self.manager.save(entry)
        logger.info("Learned: [%s] %s (confidence=%.2f)", obs.memory_type.value, obs.name, obs.confidence)
        return True

    def _detect_remember(self, msg: str) -> ConversationObservation | None:
        for pattern in REMEMBER_PATTERNS:
            if pattern.search(msg):
                content = re.sub(r"(?i)(please\s+)?remember\s+(that|this|to)\s*[:\-]?\s*", "", msg).strip()
                return ConversationObservation(
                    memory_type=MemoryType.REFERENCE,
                    name="Remembered Fact",
                    content=content,
                    confidence=0.9,
                )
        return None

    def _detect_role(self, msg: str) -> ConversationObservation | None:
        for pattern in ROLE_PATTERNS:
            m = pattern.search(msg)
            if m:
                role = m.group(2).strip()
                return ConversationObservation(
                    memory_type=MemoryType.USER,
                    name="User Role",
                    content=f"User is a {role}. {msg}",
                    confidence=0.85,
                )
        return None

    def _detect_correction(self, msg: str) -> ConversationObservation | None:
        for pattern in CORRECTION_PATTERNS:
            if pattern.search(msg):
                return ConversationObservation(
                    memory_type=MemoryType.FEEDBACK,
                    name="Work Preference",
                    content=msg,
                    confidence=0.75,
                )
        return None

    def _detect_confirmation(self, msg: str) -> ConversationObservation | None:
        for pattern in CONFIRMATION_PATTERNS:
            if pattern.search(msg):
                return ConversationObservation(
                    memory_type=MemoryType.FEEDBACK,
                    name="Preference Confirmed",
                    content=msg,
                    confidence=0.65,
                )
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/user/test_model_learner.py -v`
Expected: 8 PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/user/model_learner.py tests/unit/core/user/test_model_learner.py
git commit -m "feat(user): add UserModelLearner for pattern-based observation learning from conversations"
```

---

### Task 4: Integrate into CabinetRuntime + MemoryOrchestrator

**Files:**
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/core/memory/orchestrator.py`

- [ ] **Step 1: Wire UserProfileSystem into CabinetRuntime**

Modify `src/cabinet/runtime.py`:

```python
# Add imports
from cabinet.core.user.profile_manager import UserProfileManager
from cabinet.core.user.profile_injector import UserProfileInjector
from cabinet.core.user.model_learner import UserModelLearner

# In __init__, add new params:
def __init__(
    self,
    # ... existing params ...
    user_data_dir: str | None = None,
):
    # ... existing init ...

    user_dir = user_data_dir or "data/user"
    self._user_profile_manager = UserProfileManager(data_dir=user_dir)
    self._user_profile_injector = UserProfileInjector(self._user_profile_manager)
    self._user_model_learner = UserModelLearner(self._user_profile_manager)

# Add properties:
@property
def user_profile(self) -> UserProfileManager:
    return self._user_profile_manager

@property
def user_context(self) -> UserProfileInjector:
    return self._user_profile_injector

@property
def user_learner(self) -> UserModelLearner:
    return self._user_model_learner
```

- [ ] **Step 2: Add user profile to MemoryOrchestrator assembly**

Modify `src/cabinet/core/memory/orchestrator.py`:

```python
# In AssembledContext, add field:
@dataclass
class AssembledContext:
    # ... existing fields ...
    user_profile: str = ""  # NEW

# In assemble_context, add parameter:
async def assemble_context(
    self,
    query: str,
    employee_id: str,
    project_id: str | None = None,
    user_profile_injector = None,  # NEW
    captain_id: str = "",          # NEW
) -> AssembledContext:
    # ... existing code ...

    # Add user profile
    user_profile_text = ""
    if user_profile_injector and captain_id:
        try:
            user_profile_text = user_profile_injector.build_context(captain_id)
        except Exception:
            pass

    return AssembledContext(
        # ... existing fields ...
        user_profile=user_profile_text,
    )
```

- [ ] **Step 3: Write integration verification test**

In `tests/unit/test_runtime.py`:

```python
async def test_runtime_wires_phase3_user_modeling():
    import tempfile
    from cabinet.runtime import CabinetRuntime

    with tempfile.TemporaryDirectory() as tmp:
        runtime = CabinetRuntime(
            db_path=None,
            user_data_dir=tmp,
        )
        await runtime.start()

        assert runtime.user_profile is not None
        assert runtime.user_context is not None
        assert runtime.user_learner is not None

        from cabinet.core.user.models import MemoryType, MemoryEntry
        entry = MemoryEntry(
            memory_type=MemoryType.USER,
            name="Test User",
            content="Test engineer",
        )
        runtime.user_profile.save(entry)
        loaded = runtime.user_profile.load_all(MemoryType.USER)
        assert len(loaded) == 1

        await runtime.stop()
```

- [ ] **Step 4: Run integration test**

Run: `pytest tests/unit/test_runtime.py::test_runtime_wires_phase3_user_modeling -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest tests/ -x -q`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/runtime.py src/cabinet/core/memory/orchestrator.py tests/unit/test_runtime.py
git commit -m "feat(user): integrate UserProfileManager, Injector, and Learner into CabinetRuntime"
```

---

## Completion Checklist

- [ ] MemoryEntry supports 4 types: USER, FEEDBACK, PROJECT, REFERENCE
- [ ] UserProfileManager persists to gitignored `data/user/` directory
- [ ] MEMORY.md index file tracks all entries, capped at 200 lines
- [ ] Individual memory files have YAML frontmatter with type metadata
- [ ] UserProfileInjector builds context string for system prompt injection
- [ ] UserProfileInjector caches profile within TTL for performance
- [ ] UserModelLearner detects corrections, confirmations, "remember" commands
- [ ] UserModelLearner detects user role from self-introductions
- [ ] Low-confidence observations (< 0.6) are discarded
- [ ] MemoryOrchestrator accepts user profile for assembly
- [ ] CabinetRuntime wires all three components with sane defaults
- [ ] All existing tests pass, no regressions
