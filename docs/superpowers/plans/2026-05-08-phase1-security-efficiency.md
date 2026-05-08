# Phase 1: Security & Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install three foundation-level subsystems: Prompt Cache partitioning for 90% token cost savings, a six-layer permission defense with sandbox and circuit breaker, and per-model cost tracking with budget enforcement.

**Architecture:** Three new modules in `core/`, two existing modules enhanced. Prompt Cache splits system prompts into static (cached, 10% cost) and dynamic (uncached) partitions with cache-hit monitoring. Permission defense adds file-system sandbox, YOLO risk classifier, and denial circuit breaker as harness submodules. Cost tracking adds a lightweight `CostTracker` aggregating LiteLLM usage data into Prometheus gauges with optional budget limits.

**Tech Stack:** Python 3.12+, cryptography (Fernet for sandbox paths), litellm (usage extraction), prometheus-client (cost gauges), aiosqlite (permission rules persistence)

---

## File Structure

```
src/cabinet/core/
├── prompt_cache.py              # NEW — PromptCacheManager, static/dynamic partitioning
├── harness/
│   ├── sandbox.py               # NEW — FileSystemSandbox, protected paths
│   ├── permissions.py           # NEW — PermissionEngine, 6-layer checks
│   ├── yolo_classifier.py       # NEW — YOLOClassifier, AST-based risk assessment
│   ├── denial_tracker.py        # NEW — DenialTracker, circuit breaker
│   └── __init__.py              # MODIFY — export new classes
├── cost_tracker.py              # NEW — CostTracker, CostBudget
├── compact.py                   # MODIFY — integrate with PromptCacheManager
├── gateway/litellm_adapter.py   # MODIFY — emit cost events from complete/stream
├── observability.py             # MODIFY — add COST_GAUGE metric
└── runtime.py                   # MODIFY — wire new harness components
tests/unit/core/
├── test_prompt_cache.py         # NEW — 12 tests
├── harness/
│   ├── test_sandbox.py          # NEW — 10 tests
│   ├── test_permissions.py      # NEW — 14 tests
│   ├── test_yolo_classifier.py  # NEW — 8 tests
│   └── test_denial_tracker.py   # NEW — 6 tests
└── test_cost_tracker.py         # NEW — 10 tests
```

---

### Task 1: PromptCacheManager — Static/Dynamic Prompt Partitioning

**Files:**
- Create: `src/cabinet/core/prompt_cache.py`
- Modify: `src/cabinet/core/compact.py:1-10` (add import)
- Modify: `src/cabinet/core/gateway/litellm_adapter.py:70-120` (integrate cache hints)
- Test: `tests/unit/core/test_prompt_cache.py`

- [ ] **Step 1: Write the failing test for PromptCacheManager**

```python
from __future__ import annotations

import pytest
from cabinet.core.prompt_cache import PromptCacheManager, PromptCacheStats


def test_prompt_cache_manager_splits_at_boundary():
    manager = PromptCacheManager(
        static_prompt="You are Cabinet. You help the user with tasks.\n"
                       "---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    dynamic = "Working directory: /home/user\nGit branch: main\n"
    parts = manager.build_prompt_parts(dynamic_context=dynamic)

    assert "Cabinet" in parts["static"]
    assert "Working directory" in parts["dynamic"]
    assert "STATIC_ABOVE" not in parts["static"]
    assert "STATIC_ABOVE" not in parts["dynamic"]


def test_no_boundary_treats_everything_as_dynamic():
    manager = PromptCacheManager(
        static_prompt="Everything is dynamic here."
    )
    parts = manager.build_prompt_parts(dynamic_context="/home/user")

    assert parts["static"] == ""
    assert parts["dynamic"] == "Everything is dynamic here.\n/home/user"


def test_cache_stats_tracks_hits_and_misses():
    stats = PromptCacheStats()
    stats.record_hit()
    stats.record_hit()
    stats.record_miss()

    assert stats.hits == 2
    assert stats.misses == 1
    assert stats.hit_rate == pytest.approx(2 / 3)


def test_cache_stats_reset():
    stats = PromptCacheStats()
    stats.record_hit()
    stats.reset()
    assert stats.hits == 0
    assert stats.misses == 0
    assert stats.total_requests == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/core/test_prompt_cache.py -v`
Expected: FAIL — "No module named cabinet.core.prompt_cache"

- [ ] **Step 3: Write minimal implementation**

```python
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

STATIC_DYNAMIC_BOUNDARY = "---STATIC_ABOVE_/_DYNAMIC_BELOW---"


@dataclass
class PromptCacheStats:
    hits: int = 0
    misses: int = 0
    last_hit_at: float = 0.0
    last_miss_at: float = 0.0

    def record_hit(self) -> None:
        self.hits += 1
        self.last_hit_at = time.monotonic()

    def record_miss(self) -> None:
        self.misses += 1
        self.last_miss_at = time.monotonic()

    @property
    def total_requests(self) -> int:
        return self.hits + self.misses

    @property
    def hit_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.hits / self.total_requests

    def reset(self) -> None:
        self.hits = 0
        self.misses = 0


@dataclass
class PromptCacheManager:
    static_prompt: str = ""
    boundary: str = STATIC_DYNAMIC_BOUNDARY
    cache_version: int = 1
    stats: PromptCacheStats = field(default_factory=PromptCacheStats)

    def build_prompt_parts(self, dynamic_context: str = "") -> dict[str, str]:
        if self.boundary not in self.static_prompt:
            return {
                "static": "",
                "dynamic": self.static_prompt + "\n" + dynamic_context,
            }

        parts = self.static_prompt.split(self.boundary, 1)
        static = parts[0].strip()
        trailing = parts[1].strip() if len(parts) > 1 else ""
        dynamic = (trailing + "\n" + dynamic_context).strip()

        logger.debug(
            "Prompt cache split: static=%d chars, dynamic=%d chars",
            len(static), len(dynamic),
        )
        return {"static": static, "dynamic": dynamic}

    def build_anthropic_system(
        self,
        dynamic_context: str = "",
        extra_systems: list[dict] | None = None,
    ) -> list[dict]:
        parts = self.build_prompt_parts(dynamic_context)
        systems: list[dict] = []

        if parts["static"]:
            systems.append({
                "type": "text",
                "text": parts["static"],
                "cache_control": {"type": "ephemeral"},
            })
        if parts["dynamic"]:
            systems.append({
                "type": "text",
                "text": parts["dynamic"],
            })
        for extra in (extra_systems or []):
            systems.append(extra)

        return systems

    @staticmethod
    def estimate_cache_savings(
        static_chars: int, cost_per_million_input: float = 3.0
    ) -> float:
        static_tokens = max(1, static_chars // 4)
        uncached_cost = (static_tokens / 1_000_000) * cost_per_million_input
        cached_cost = uncached_cost * 0.10
        return uncached_cost - cached_cost
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/unit/core/test_prompt_cache.py -v`
Expected: 4 PASS

- [ ] **Step 5: Write test for hash-based cache invalidation detection**

```python
def test_cache_fingerprint_changes_on_static_modification():
    manager = PromptCacheManager(
        static_prompt="System: Version 1\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    fp1 = manager.fingerprint()

    manager.static_prompt = "System: Version 2\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    fp2 = manager.fingerprint()

    assert fp1 != fp2


def test_cache_fingerprint_stable_for_same_content():
    manager1 = PromptCacheManager(static_prompt="System: Version 1\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n")
    manager2 = PromptCacheManager(static_prompt="System: Version 1\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n")
    assert manager1.fingerprint() == manager2.fingerprint()
```

- [ ] **Step 6: Run test to verify it fails, then add fingerprint method**

Run: `pytest tests/unit/core/test_prompt_cache.py::test_cache_fingerprint_changes_on_static_modification tests/unit/core/test_prompt_cache.py::test_cache_fingerprint_stable_for_same_content -v`
Expected: FAIL

Add to `PromptCacheManager`:
```python
import hashlib

def fingerprint(self) -> str:
    return hashlib.sha256(self.static_prompt.encode()).hexdigest()[:16]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/unit/core/test_prompt_cache.py -v`
Expected: 6 PASS

- [ ] **Step 8: Integrate PromptCacheManager into ContextCompactor**

Modify `src/cabinet/core/compact.py`:

```python
# Add import at top
from cabinet.core.prompt_cache import PromptCacheManager

# Add to ContextCompactor.__init__:
def __init__(
    self,
    gateway,
    session_memory_path: Path | None = None,
    model: str = "default",
    max_failures: int = 3,
    prompt_cache_manager: PromptCacheManager | None = None,  # NEW
):
    # ... existing init ...
    self._prompt_cache = prompt_cache_manager or PromptCacheManager()

# Add method to ContextCompactor:
@property
def prompt_cache(self) -> PromptCacheManager:
    return self._prompt_cache
```

- [ ] **Step 9: Write integration test for end-to-end prompt building**

```python
async def test_compactor_uses_prompt_cache_manager():
    from cabinet.core.compact import ContextCompactor
    from cabinet.core.prompt_cache import PromptCacheManager

    pm = PromptCacheManager(
        static_prompt="You are Cabinet.\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    compactor = ContextCompactor(
        gateway=None,
        prompt_cache_manager=pm,
    )
    parts = compactor.prompt_cache.build_prompt_parts(
        dynamic_context="CWD: /project\n",
    )
    assert "You are Cabinet." in parts["static"]
    assert "CWD: /project" in parts["dynamic"]
```

- [ ] **Step 10: Commit**

```bash
git add tests/unit/core/test_prompt_cache.py src/cabinet/core/prompt_cache.py src/cabinet/core/compact.py
git commit -m "feat(compact): add PromptCacheManager for static/dynamic prompt partitioning"
```

---

### Task 2: FileSystemSandbox — Protected Path Enforcement

**Files:**
- Create: `src/cabinet/core/harness/sandbox.py`
- Test: `tests/unit/core/harness/test_sandbox.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from cabinet.core.harness.sandbox import FileSystemSandbox


@pytest.fixture
def sandbox():
    return FileSystemSandbox()


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


class TestProtectedPaths:
    def test_gitconfig_is_protected(self, sandbox):
        assert sandbox.is_protected(Path.home() / ".gitconfig")

    def test_git_dir_is_protected(self, sandbox, temp_dir):
        git_dir = temp_dir / ".git"
        git_dir.mkdir()
        assert sandbox.is_protected(git_dir)

    def test_dot_env_is_protected(self, sandbox, temp_dir):
        env_file = temp_dir / ".env"
        env_file.touch()
        assert sandbox.is_protected(env_file)

    def test_claude_dir_is_protected(self, sandbox, temp_dir):
        claude_dir = temp_dir / ".claude"
        claude_dir.mkdir()
        assert sandbox.is_protected(claude_dir)

    def test_bashrc_is_protected(self, sandbox, temp_dir):
        bashrc = temp_dir / ".bashrc"
        bashrc.touch()
        assert sandbox.is_protected(bashrc)


class TestSafePaths:
    def test_regular_py_file_is_allowed(self, sandbox, temp_dir):
        py_file = temp_dir / "app.py"
        py_file.touch()
        assert not sandbox.is_protected(py_file)

    def test_src_directory_is_allowed(self, sandbox, temp_dir):
        src = temp_dir / "src"
        src.mkdir()
        assert not sandbox.is_protected(src)

    def test_data_directory_is_allowed(self, sandbox, temp_dir):
        data = temp_dir / "data"
        data.mkdir()
        assert not sandbox.is_protected(data)

    def test_regular_txt_file_is_allowed(self, sandbox, temp_dir):
        txt = temp_dir / "README.md"
        txt.touch()
        assert not sandbox.is_protected(txt)


class TestSymlinkProtection:
    def test_symlink_to_protected_path_is_detected(self, sandbox, temp_dir):
        if os.name == "nt":
            pytest.skip("Symlinks require admin on Windows")
        real_gitconfig = temp_dir / ".gitconfig"
        real_gitconfig.touch()
        symlink = temp_dir / "safe_link"
        symlink.symlink_to(real_gitconfig)
        assert sandbox.is_protected(symlink)


class TestCustomRules:
    def test_can_add_custom_protected_patterns(self, sandbox, temp_dir):
        sandbox.add_protected_pattern("*.secret")
        secret_file = temp_dir / "db.secret"
        secret_file.touch()
        assert sandbox.is_protected(secret_file)

    def test_can_remove_default_patterns(self, sandbox, temp_dir):
        sandbox.remove_protected_pattern(".gitconfig")
        gitconfig = temp_dir / ".gitconfig"
        gitconfig.touch()
        assert not sandbox.is_protected(gitconfig)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/harness/test_sandbox.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```python
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_PROTECTED_NAMES: set[str] = {
    ".git",
    ".gitconfig",
    ".gitattributes",
    ".gitmodules",
    ".gitignore",
    ".bashrc",
    ".bash_profile",
    ".zshrc",
    ".zprofile",
    ".profile",
    ".env",
    ".envrc",
    ".claude",
    ".vscode",
    ".idea",
    ".mcp.json",
    "credentials.json",
    "keyfile.json",
    "service-account.json",
}

DEFAULT_PROTECTED_PATTERNS: set[str] = {
    "*.pem",
    "*.key",
    "*.pfx",
    "*.p12",
    "*.keystore",
}


class FileSystemSandbox:
    def __init__(
        self,
        protected_names: set[str] | None = None,
        protected_patterns: set[str] | None = None,
    ):
        self._protected_names = set(protected_names or DEFAULT_PROTECTED_NAMES)
        self._protected_patterns = set(protected_patterns or DEFAULT_PROTECTED_PATTERNS)

    def is_protected(self, path: Path) -> bool:
        resolved = path.resolve()

        if self._matches_name(resolved):
            return True

        if self._matches_pattern(resolved):
            return True

        if self._is_inside_protected_dir(resolved):
            return True

        return False

    def _matches_name(self, path: Path) -> bool:
        return path.name in self._protected_names

    def _matches_pattern(self, path: Path) -> bool:
        from fnmatch import fnmatch

        name = path.name
        for pattern in self._protected_patterns:
            if fnmatch(name, pattern):
                return True
        return False

    def _is_inside_protected_dir(self, path: Path) -> bool:
        parts = path.parts
        for name in self._protected_names:
            if name in parts and name.startswith("."):
                return True
        return False

    def add_protected_pattern(self, pattern: str) -> None:
        self._protected_patterns.add(pattern)
        logger.info("Added protected pattern: %s", pattern)

    def remove_protected_pattern(self, pattern: str) -> None:
        self._protected_patterns.discard(pattern)
        self._protected_names.discard(pattern)
        logger.info("Removed protected pattern: %s", pattern)

    @property
    def protected_paths(self) -> list[str]:
        return sorted(self._protected_names | self._protected_patterns)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/harness/test_sandbox.py -v`
Expected: 10 PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/core/harness/test_sandbox.py src/cabinet/core/harness/sandbox.py
git commit -m "feat(harness): add FileSystemSandbox for protected path enforcement"
```

---

### Task 3: DenialTracker — Circuit Breaker Pattern

**Files:**
- Create: `src/cabinet/core/harness/denial_tracker.py`
- Test: `tests/unit/core/harness/test_denial_tracker.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

from cabinet.core.harness.denial_tracker import DenialTracker


class TestDenialTracking:
    def test_consecutive_denials_increment(self):
        tracker = DenialTracker(max_consecutive=3, max_total=20)
        assert not tracker.is_circuit_open()

        tracker.record_denial("bash", "rm -rf /")
        tracker.record_denial("bash", "git push --force")
        assert tracker.consecutive == 2
        assert tracker.total == 2
        assert not tracker.is_circuit_open()

    def test_circuit_opens_after_max_consecutive(self):
        tracker = DenialTracker(max_consecutive=3, max_total=20)
        tracker.record_denial("bash", "sudo rm")
        tracker.record_denial("bash", "chmod 777")
        tracker.record_denial("bash", "git push --force main")
        assert tracker.is_circuit_open()

    def test_success_resets_consecutive_but_not_total(self):
        tracker = DenialTracker(max_consecutive=3, max_total=20)
        tracker.record_denial("bash", "sudo rm")
        tracker.record_denial("bash", "chmod 777")
        assert tracker.consecutive == 2

        tracker.record_success("grep")
        assert tracker.consecutive == 0
        assert tracker.total == 2

    def test_total_circuit_opens_at_max_total(self):
        tracker = DenialTracker(max_consecutive=3, max_total=5)
        for i in range(5):
            tracker.record_denial("bash", f"dangerous cmd {i}")
            tracker.record_success("grep")
        assert tracker.consecutive == 0
        assert tracker.is_circuit_open()

    def test_reset_clears_all_counters(self):
        tracker = DenialTracker()
        tracker.record_denial("bash", "rm")
        tracker.record_denial("bash", "sudo")
        tracker.reset()
        assert tracker.consecutive == 0
        assert tracker.total == 0
        assert not tracker.is_circuit_open()

    def test_denials_include_tool_name_and_input(self):
        tracker = DenialTracker()
        tracker.record_denial("bash", "rm -rf /")
        assert len(tracker.recent_denials) == 1
        assert tracker.recent_denials[0]["tool"] == "bash"
        assert "rm -rf" in tracker.recent_denials[0]["input"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/harness/test_denial_tracker.py -v`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```python
from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class DenialTracker:
    max_consecutive: int = 3
    max_total: int = 20
    consecutive: int = 0
    total: int = 0
    recent_denials: list[dict] = field(default_factory=list)
    _max_recent: int = 50

    def record_denial(self, tool_name: str, tool_input: str = "") -> None:
        self.consecutive += 1
        self.total += 1
        self.recent_denials.append({
            "tool": tool_name,
            "input": tool_input[:200],
        })
        if len(self.recent_denials) > self._max_recent:
            self.recent_denials = self.recent_denials[-self._max_recent:]

        logger.warning(
            "Denial #%d (consecutive=%d, total=%d) for %s",
            self.total, self.consecutive, self.total, tool_name,
        )

    def record_success(self, tool_name: str) -> None:
        if self.consecutive > 0:
            logger.info(
                "Consecutive denial streak broken by %s (was %d)",
                tool_name, self.consecutive,
            )
        self.consecutive = 0

    def is_circuit_open(self) -> bool:
        if self.consecutive >= self.max_consecutive:
            logger.error(
                "CIRCUIT BREAKER OPEN: %d consecutive denials",
                self.consecutive,
            )
            return True
        if self.total >= self.max_total:
            logger.error(
                "CIRCUIT BREAKER OPEN: %d total denials",
                self.total,
            )
            return True
        return False

    def reset(self) -> None:
        self.consecutive = 0
        self.total = 0
        self.recent_denials.clear()
        logger.info("DenialTracker reset")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/harness/test_denial_tracker.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/core/harness/test_denial_tracker.py src/cabinet/core/harness/denial_tracker.py
git commit -m "feat(harness): add DenialTracker with circuit breaker pattern"
```

---

### Task 4: PermissionEngine — Six-Layer Permission Defense

**Files:**
- Create: `src/cabinet/core/harness/permissions.py`
- Modify: `src/cabinet/core/harness/__init__.py`
- Test: `tests/unit/core/harness/test_permissions.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

from dataclasses import dataclass

import pytest
from cabinet.core.harness.permissions import (
    PermissionEngine,
    PermissionMode,
    PermissionResult,
    PermissionContext,
    ToolPermissionRule,
)
from cabinet.core.harness.sandbox import FileSystemSandbox
from cabinet.core.harness.denial_tracker import DenialTracker


def _make_context(tool="bash", params=None, mode=PermissionMode.DEFAULT):
    return PermissionContext(
        tool_name=tool,
        tool_params=params or {},
        mode=mode,
        working_dir="/tmp/test",
    )


class TestPermissionModes:
    def test_bypass_skips_most_checks(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="bash", params={"command": "rm file"},
                            mode=PermissionMode.BYPASS)
        result = engine.check(ctx)
        assert result.allowed

    def test_plan_mode_blocks_write_tools(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Write", mode=PermissionMode.PLAN)
        result = engine.check(ctx)
        assert not result.allowed

    def test_plan_mode_allows_read_tools(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Read", mode=PermissionMode.PLAN)
        result = engine.check(ctx)
        assert result.allowed

    def test_dont_ask_mode_denies_when_ask_required(self):
        engine = PermissionEngine()
        engine.add_ask_rule("bash", "git push*")
        ctx = _make_context(tool="bash", params={"command": "git push origin main"},
                            mode=PermissionMode.DONT_ASK)
        result = engine.check(ctx)
        assert not result.allowed

    def test_default_mode_requires_input_for_write(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Write", mode=PermissionMode.DEFAULT)
        result = engine.check(ctx)
        assert result.needs_user_input


class TestToolDenyRules:
    def test_deny_rule_blocks_regardless_of_mode(self):
        engine = PermissionEngine()
        engine.add_deny_rule("bash", "rm -rf *")
        ctx = _make_context(tool="bash", params={"command": "rm -rf /"},
                            mode=PermissionMode.BYPASS)
        result = engine.check(ctx)
        assert not result.allowed
        assert "deny rule" in result.reason.lower()

    def test_sandbox_protected_paths_blocked_in_bypass(self):
        engine = PermissionEngine()
        ctx = _make_context(
            tool="Write",
            params={"file_path": "/home/user/.gitconfig"},
            mode=PermissionMode.BYPASS,
        )
        result = engine.check(ctx)
        assert not result.allowed


class TestAutoModeClassifier:
    def test_safe_read_tool_allowed_without_ask(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Read", mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.allowed

    def test_safe_search_tool_allowed_without_ask(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Grep", mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.allowed

    def test_dangerous_bash_requires_ask_in_auto(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="bash", params={"command": "sudo rm -rf /"},
                            mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.needs_user_input

    def test_circuit_open_blocks_in_auto_mode(self):
        engine = PermissionEngine()
        engine.denial_tracker.record_denial("bash", "rm")
        engine.denial_tracker.record_denial("bash", "rm")
        engine.denial_tracker.record_denial("bash", "rm")
        ctx = _make_context(tool="bash", params={"command": "ls"},
                            mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert not result.allowed


class TestPermissionRules:
    def test_always_allow_rule_overrides_auto_classifier(self):
        engine = PermissionEngine()
        engine.add_allow_rule("bash", "ls *")
        ctx = _make_context(tool="bash", params={"command": "ls -la"},
                            mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.allowed

    def test_rule_pattern_matching(self):
        engine = PermissionEngine()
        engine.add_allow_rule("bash", "git status*")
        ctx = _make_context(tool="bash", params={"command": "git status"},
                            mode=PermissionMode.DEFAULT)
        result = engine.check(ctx)
        assert result.allowed
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/harness/test_permissions.py -v`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```python
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from fnmatch import fnmatch
from pathlib import Path

logger = logging.getLogger(__name__)


class PermissionMode(str, Enum):
    DEFAULT = "default"
    PLAN = "plan"
    ACCEPT_EDITS = "accept_edits"
    AUTO = "auto"
    BYPASS = "bypass_permissions"
    DONT_ASK = "dont_ask"


@dataclass
class PermissionResult:
    allowed: bool
    needs_user_input: bool = False
    reason: str = ""


@dataclass
class ToolPermissionRule:
    tool_name: str
    pattern: str = "*"
    mode: str = "allow"


@dataclass
class PermissionContext:
    tool_name: str
    tool_params: dict = field(default_factory=dict)
    mode: PermissionMode = PermissionMode.DEFAULT
    working_dir: str = ""


SAFE_TOOLS: set[str] = {
    "Read", "Glob", "Grep", "TodoWrite", "SendMessage",
    "TaskCreate", "TaskUpdate",
}

WRITE_TOOLS: set[str] = {
    "Write", "Edit", "NotebookEdit", "Bash",
}

DANGEROUS_PATTERNS: list[str] = [
    "rm -rf *", "rm -r /*", "sudo *", "git push --force*",
    "git reset --hard*", "chmod 777*", "chown *", ":(){ :|:& };:*",
    "> /dev/sda*", "dd if=*", "mkfs.*", "format *",
    "docker rm*", "docker system prune*",
    "DROP TABLE*", "DELETE FROM*", "TRUNCATE*",
]


class PermissionEngine:
    def __init__(
        self,
        sandbox: "FileSystemSandbox | None" = None,
        denial_tracker: "DenialTracker | None" = None,
    ):
        from cabinet.core.harness.sandbox import FileSystemSandbox
        from cabinet.core.harness.denial_tracker import DenialTracker

        self._sandbox = sandbox or FileSystemSandbox()
        self._denial_tracker = denial_tracker or DenialTracker()
        self._deny_rules: list[ToolPermissionRule] = []
        self._ask_rules: list[ToolPermissionRule] = []
        self._allow_rules: list[ToolPermissionRule] = []

    def check(self, ctx: PermissionContext) -> PermissionResult:
        # Layer 1: Deny rules — immune to all modes
        for rule in self._deny_rules:
            if self._match_rule(rule, ctx):
                return PermissionResult(
                    allowed=False,
                    reason=f"Blocked by deny rule: {rule.tool_name}/{rule.pattern}",
                )

        # Layer 1b: Sandbox protected paths — immune to all modes
        if self._writes_to_protected_path(ctx):
            return PermissionResult(
                allowed=False,
                reason="Target path is protected by FileSystemSandbox",
            )

        # Layer 2: Mode filter
        if ctx.mode == PermissionMode.BYPASS:
            return PermissionResult(allowed=True, reason="Bypass mode")

        # Layer 3: DontAsk auto-deny for ask-requiring tools
        if ctx.mode == PermissionMode.DONT_ASK:
            for rule in self._ask_rules:
                if self._match_rule(rule, ctx):
                    return PermissionResult(
                        allowed=False,
                        reason=f"Ask-required in dont_ask mode: {rule.tool_name}",
                    )

        # Layer 3b: Plan mode blocks writes
        if ctx.mode == PermissionMode.PLAN:
            if ctx.tool_name in WRITE_TOOLS:
                return PermissionResult(
                    allowed=False,
                    reason=f"Write tool {ctx.tool_name} blocked in plan mode",
                )

        # Layer 4: Always-allow rules
        for rule in self._allow_rules:
            if self._match_rule(rule, ctx):
                return PermissionResult(
                    allowed=True,
                    reason=f"Allowed by rule: {rule.tool_name}/{rule.pattern}",
                )

        # Layer 5: AUTO mode classifier
        if ctx.mode == PermissionMode.AUTO:
            return self._auto_classify(ctx)

        # Layer 5b: AcceptEdits mode
        if ctx.mode == PermissionMode.ACCEPT_EDITS:
            if ctx.tool_name in SAFE_TOOLS or ctx.tool_name in {"Write", "Edit"}:
                return PermissionResult(allowed=True, reason="AcceptEdits mode")
            return self._auto_classify(ctx)

        # Layer 6: User interaction required
        if ctx.tool_name in WRITE_TOOLS:
            return PermissionResult(
                allowed=False,
                needs_user_input=True,
                reason=f"Write tool {ctx.tool_name} requires user confirmation",
            )

        return PermissionResult(allowed=True, reason="Read tool, default allow")

    def _auto_classify(self, ctx: PermissionContext) -> PermissionResult:
        if self._denial_tracker.is_circuit_open():
            return PermissionResult(
                allowed=False,
                reason="Circuit breaker open — too many denials",
            )

        if ctx.tool_name in SAFE_TOOLS:
            return PermissionResult(allowed=True, reason="Safe tool, auto allow")

        if ctx.tool_name == "Bash" or ctx.tool_name == "bash":
            command = str(ctx.tool_params.get("command", ""))
            for pattern in DANGEROUS_PATTERNS:
                if fnmatch(command, pattern):
                    return PermissionResult(
                        allowed=False,
                        needs_user_input=True,
                        reason=f"Potentially dangerous command matches '{pattern}'",
                    )

        if ctx.tool_name in WRITE_TOOLS:
            return PermissionResult(
                allowed=False,
                needs_user_input=True,
                reason=f"Write tool {ctx.tool_name} requires confirmation in auto mode",
            )

        return PermissionResult(allowed=True, reason="Auto classifier: allowed")

    def _writes_to_protected_path(self, ctx: PermissionContext) -> bool:
        if ctx.tool_name not in WRITE_TOOLS:
            return False
        file_path = ctx.tool_params.get("file_path", "")
        if file_path:
            return self._sandbox.is_protected(Path(file_path))
        return False

    def _match_rule(self, rule: ToolPermissionRule, ctx: PermissionContext) -> bool:
        if rule.tool_name != ctx.tool_name:
            return False
        if rule.pattern == "*":
            return True
        if ctx.tool_name in ("Bash", "bash"):
            command = str(ctx.tool_params.get("command", ""))
            return fnmatch(command, rule.pattern)
        return fnmatch(str(ctx.tool_params), rule.pattern)

    def add_deny_rule(self, tool: str, pattern: str = "*") -> None:
        self._deny_rules.append(ToolPermissionRule(tool_name=tool, pattern=pattern, mode="deny"))

    def add_ask_rule(self, tool: str, pattern: str = "*") -> None:
        self._ask_rules.append(ToolPermissionRule(tool_name=tool, pattern=pattern, mode="ask"))

    def add_allow_rule(self, tool: str, pattern: str = "*") -> None:
        self._allow_rules.append(ToolPermissionRule(tool_name=tool, pattern=pattern, mode="allow"))

    @property
    def denial_tracker(self):
        return self._denial_tracker

    @property
    def sandbox(self):
        return self._sandbox
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/harness/test_permissions.py -v`
Expected: 14 PASS

- [ ] **Step 5: Update harness `__init__.py` to export new classes**

```python
from cabinet.core.harness.sandbox import FileSystemSandbox
from cabinet.core.harness.permissions import PermissionEngine, PermissionMode, PermissionResult, PermissionContext
from cabinet.core.harness.denial_tracker import DenialTracker
```

- [ ] **Step 6: Commit**

```bash
git add tests/unit/core/harness/test_permissions.py src/cabinet/core/harness/permissions.py src/cabinet/core/harness/__init__.py
git commit -m "feat(harness): add PermissionEngine with six-layer defense and YOLO auto-classifier"
```

---

### Task 5: CostTracker — Per-Model Cost Accounting

**Files:**
- Create: `src/cabinet/core/cost_tracker.py`
- Modify: `src/cabinet/core/observability.py` (add COST_GAUGE)
- Modify: `src/cabinet/core/gateway/litellm_adapter.py` (emit cost data)
- Test: `tests/unit/core/test_cost_tracker.py`

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import pytest
from cabinet.core.cost_tracker import CostTracker, CostBudget, ModelPricing


class TestModelPricing:
    def test_lookup_by_model_name(self):
        pricing = ModelPricing()
        price = pricing.get_prices("openai/gpt-4o")
        assert price["input"] > 0
        assert price["output"] > 0

    def test_unknown_model_returns_default(self):
        pricing = ModelPricing()
        price = pricing.get_prices("unknown/unknown")
        assert price["input"] == 1.0
        assert price["output"] == 3.0


class TestCostTracker:
    def test_record_usage_accumulates(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=1000, completion_tokens=500)
        assert tracker.total_cost_usd > 0
        assert tracker.model_usage["openai/gpt-4o"]["input_tokens"] == 1000
        assert tracker.model_usage["openai/gpt-4o"]["output_tokens"] == 500

    def test_multiple_models_tracked_separately(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=1000, completion_tokens=500)
        tracker.record_usage("anthropic/claude-sonnet-4-6", prompt_tokens=2000, completion_tokens=300)
        assert len(tracker.model_usage) == 2

    def test_cache_hit_records_discounted_cost(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=5000, completion_tokens=500,
                             cache_read_tokens=5000)
        assert tracker.model_usage["openai/gpt-4o"]["cache_read_tokens"] == 5000

    def test_reset_clears_all_usage(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=1000, completion_tokens=500)
        tracker.reset()
        assert tracker.total_cost_usd == 0.0
        assert len(tracker.model_usage) == 0


class TestCostBudget:
    def test_remaining_decreases_with_usage(self):
        budget = CostBudget(limit_usd=1.00)
        budget.spend(0.30)
        assert budget.remaining_usd == pytest.approx(0.70)

    def test_is_exhausted_when_over_limit(self):
        budget = CostBudget(limit_usd=0.10)
        budget.spend(0.15)
        assert budget.is_exhausted

    def test_can_call_within_budget(self):
        budget = CostBudget(limit_usd=0.50)
        assert budget.can_spend(estimated=0.30)
        assert not budget.can_spend(estimated=0.60)

    def test_warning_threshold_triggered(self):
        budget = CostBudget(limit_usd=1.00, warning_threshold=0.50)
        budget.spend(0.60)
        assert budget.is_over_warning

    def test_format_for_display(self):
        budget = CostBudget(limit_usd=1.00)
        budget.spend(0.326)
        display = budget.format()
        assert "$0.33" in display
        assert "$1.00" in display
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/test_cost_tracker.py -v`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```python
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DEFAULT_PRICING: dict[str, dict[str, float]] = {
    "openai/gpt-4o": {"input": 2.50, "output": 10.00},
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "openai/gpt-4": {"input": 30.00, "output": 60.00},
    "anthropic/claude-opus-4-7": {"input": 15.00, "output": 75.00},
    "anthropic/claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "anthropic/claude-haiku-4-5": {"input": 0.80, "output": 4.00},
    "deepseek/deepseek-v4-pro": {"input": 0.55, "output": 2.19},
    "deepseek/deepseek-v4-flash": {"input": 0.14, "output": 0.28},
    "google/gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "google/gemini-2.5-flash": {"input": 0.075, "output": 0.30},
    "ollama/llama3": {"input": 0.0, "output": 0.0},
}


class ModelPricing:
    def __init__(self, overrides: dict[str, dict[str, float]] | None = None):
        self._pricing = dict(DEFAULT_PRICING)
        if overrides:
            self._pricing.update(overrides)

    def get_prices(self, model: str) -> dict[str, float]:
        if model in self._pricing:
            return dict(self._pricing[model])
        for prefix, prices in self._pricing.items():
            if model.startswith(prefix.rstrip("*")):
                return dict(prices)
        return {"input": 1.0, "output": 3.0}


@dataclass
class ModelUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    cost_usd: float = 0.0
    calls: int = 0


@dataclass
class CostBudget:
    limit_usd: float
    spent_usd: float = 0.0
    warning_threshold: float = 0.80

    @property
    def remaining_usd(self) -> float:
        return max(0.0, self.limit_usd - self.spent_usd)

    @property
    def is_exhausted(self) -> bool:
        return self.spent_usd >= self.limit_usd

    @property
    def is_over_warning(self) -> bool:
        return (self.spent_usd / self.limit_usd) >= self.warning_threshold if self.limit_usd > 0 else False

    def spend(self, amount: float) -> None:
        self.spent_usd += amount

    def can_spend(self, estimated: float) -> bool:
        return (self.spent_usd + estimated) <= self.limit_usd

    def format(self) -> str:
        return (
            f"${self.spent_usd:.2f} / ${self.limit_usd:.2f} "
            f"({(self.spent_usd / self.limit_usd * 100):.0f}%)"
            if self.limit_usd > 0
            else f"${self.spent_usd:.2f} (no limit)"
        )


class CostTracker:
    def __init__(self, pricing: ModelPricing | None = None, budget: CostBudget | None = None):
        self._pricing = pricing or ModelPricing()
        self._budget = budget
        self._model_usage: dict[str, ModelUsage] = {}
        self._start_time = time.monotonic()

    def record_usage(
        self,
        model: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        cache_creation_tokens: int = 0,
        cache_read_tokens: int = 0,
    ) -> None:
        if model not in self._model_usage:
            self._model_usage[model] = ModelUsage()

        usage = self._model_usage[model]
        usage.input_tokens += prompt_tokens
        usage.output_tokens += completion_tokens
        usage.cache_creation_tokens += cache_creation_tokens
        usage.cache_read_tokens += cache_read_tokens
        usage.calls += 1

        prices = self._pricing.get_prices(model)
        input_price = prices["input"] / 1_000_000
        output_price = prices["output"] / 1_000_000

        cost = prompt_tokens * input_price + completion_tokens * output_price
        if cache_read_tokens > 0:
            cost += cache_read_tokens * input_price * 0.10
        if cache_creation_tokens > 0:
            cost += cache_creation_tokens * input_price * 0.25

        usage.cost_usd += cost

        if self._budget:
            self._budget.spend(cost)

        logger.debug(
            "Cost: model=%s cost=$%.6f total=$%.4f",
            model, cost, self.total_cost_usd,
        )

    @property
    def total_cost_usd(self) -> float:
        return sum(u.cost_usd for u in self._model_usage.values())

    @property
    def total_input_tokens(self) -> int:
        return sum(u.input_tokens for u in self._model_usage.values())

    @property
    def total_output_tokens(self) -> int:
        return sum(u.output_tokens for u in self._model_usage.values())

    @property
    def model_usage(self) -> dict:
        result = {}
        for model, usage in self._model_usage.items():
            result[model] = {
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_read_tokens": usage.cache_read_tokens,
                "cache_creation_tokens": usage.cache_creation_tokens,
                "cost_usd": usage.cost_usd,
                "calls": usage.calls,
            }
        return result

    @property
    def budget(self) -> CostBudget | None:
        return self._budget

    @property
    def uptime_seconds(self) -> float:
        return time.monotonic() - self._start_time

    def reset(self) -> None:
        self._model_usage.clear()
        self._start_time = time.monotonic()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/test_cost_tracker.py -v`
Expected: 10 PASS

- [ ] **Step 5: Integrate CostTracker into LiteLLMRouterGateway**

Modify `src/cabinet/core/gateway/litellm_adapter.py`:

```python
# Add to __init__:
def __init__(
    self,
    # ... existing params ...
    cost_tracker: "CostTracker | None" = None,  # NEW
):
    # ... existing init code ...
    self._cost_tracker = cost_tracker

# Add after response.usage extraction in complete():
if self._cost_tracker and response.usage:
    self._cost_tracker.record_usage(
        model=model,
        prompt_tokens=response.usage.prompt_tokens or 0,
        completion_tokens=response.usage.completion_tokens or 0,
        cache_read_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
        cache_creation_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
    )

# Add property:
@property
def cost_tracker(self):
    return self._cost_tracker
```

- [ ] **Step 6: Add COST_GAUGE to observability**

Modify `src/cabinet/core/observability.py`:
```python
COST_USD = Gauge(
    "cabinet_cost_usd_total",
    "Total LLM API cost in USD",
    ["model"],
    registry=PROMETHEUS_REGISTRY,
)
```

- [ ] **Step 7: Commit**

```bash
git add tests/unit/core/test_cost_tracker.py src/cabinet/core/cost_tracker.py src/cabinet/core/gateway/litellm_adapter.py src/cabinet/core/observability.py
git commit -m "feat(cost): add CostTracker with per-model cost accounting and budget enforcement"
```

---

### Task 6: Wire New Components into CabinetRuntime

**Files:**
- Modify: `src/cabinet/runtime.py`

- [ ] **Step 1: Add imports and constructor parameters**

Modify `src/cabinet/runtime.py`:

```python
# Add imports
from cabinet.core.harness.permissions import PermissionEngine, PermissionMode
from cabinet.core.harness.sandbox import FileSystemSandbox
from cabinet.core.harness.denial_tracker import DenialTracker
from cabinet.core.prompt_cache import PromptCacheManager
from cabinet.core.cost_tracker import CostTracker, CostBudget

# In CabinetRuntime.__init__, add new params:
def __init__(
    self,
    # ... existing params ...
    sandbox: FileSystemSandbox | None = None,
    permission_engine: PermissionEngine | None = None,
    denial_tracker: DenialTracker | None = None,
    prompt_cache_manager: PromptCacheManager | None = None,
    cost_tracker: CostTracker | None = None,
    cost_budget_limit_usd: float | None = None,
):
    # ... existing init ...
    self._sandbox = sandbox or FileSystemSandbox()
    self._denial_tracker = denial_tracker or DenialTracker()
    self._permission_engine = permission_engine or PermissionEngine(
        sandbox=self._sandbox,
        denial_tracker=self._denial_tracker,
    )
    self._prompt_cache = prompt_cache_manager or PromptCacheManager()
    self._cost_budget = CostBudget(limit_usd=cost_budget_limit_usd or float("inf"))
    self._cost_tracker = cost_tracker or CostTracker(budget=self._cost_budget)

# Add properties:
@property
def sandbox(self) -> FileSystemSandbox:
    return self._sandbox

@property
def permission_engine(self) -> PermissionEngine:
    return self._permission_engine

@property
def prompt_cache(self) -> PromptCacheManager:
    return self._prompt_cache

@property
def cost_tracker(self) -> CostTracker:
    return self._cost_tracker

@property
def cost_budget(self) -> CostBudget:
    return self._cost_budget
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `pytest tests/unit/ -x -q`
Expected: All existing tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/runtime.py
git commit -m "feat(runtime): wire PromptCacheManager, PermissionEngine, Sandbox, and CostTracker into CabinetRuntime"
```

---

### Task 7: Integration Test — Full Phase 1 Verification

**Files:**
- Modify: `tests/unit/test_runtime.py` (add new test)

- [ ] **Step 1: Write integration verification test**

```python
async def test_runtime_wires_phase1_security_and_efficiency_components():
    from cabinet.runtime import CabinetRuntime
    from cabinet.core.harness.permissions import PermissionContext, PermissionMode

    runtime = CabinetRuntime()
    await runtime.start()

    assert runtime.permission_engine is not None
    assert runtime.sandbox is not None
    assert runtime.prompt_cache is not None
    assert runtime.cost_tracker is not None

    result = runtime.permission_engine.check(
        PermissionContext(
            tool_name="Read",
            mode=PermissionMode.AUTO,
        )
    )
    assert result.allowed

    await runtime.stop()
```

- [ ] **Step 2: Run integration test**

Run: `pytest tests/unit/test_runtime.py::test_runtime_wires_phase1_security_and_efficiency_components -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pytest tests/ -x -q`
Expected: All tests pass, no regressions

- [ ] **Step 4: Final commit**

```bash
git add tests/unit/test_runtime.py
git commit -m "test(runtime): verify Phase 1 security and efficiency components are wired"
```

---

## Completion Checklist

- [ ] PromptCacheManager splits prompt at boundary, reports cache stats
- [ ] FileSystemSandbox protects `.gitconfig`, `.env`, `.git/`, `.claude/`, `.bashrc`
- [ ] DenialTracker opens circuit at 3 consecutive / 20 total denials
- [ ] PermissionEngine enforces 6 layers, deny rules immune to bypass
- [ ] YOLO classifier auto-allows safe tools, flags dangerous patterns
- [ ] CostTracker records per-model usage, computes USD cost with cache discounts
- [ ] CostBudget enforces limit, warns at 80% threshold
- [ ] CabinetRuntime wires all new components with sane defaults
- [ ] All existing tests pass, no regressions
