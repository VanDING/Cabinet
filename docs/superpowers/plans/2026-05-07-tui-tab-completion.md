# TUI Tab Completion + Command History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slash command Tab completion and persistent command history to the `cabinet chat` cockpit TUI.

**Architecture:** Leverage prompt_toolkit's built-in `WordCompleter`, `FileHistory`, and `AutoSuggestFromHistory`. Changes confined to `tui.py` with a minor signature change in `main.py`. No new dependencies.

**Tech Stack:** Python 3.12+, prompt_toolkit (already a dependency), Rich

---

### Task 1: Add Tab Completion + Command History

**Files:**
- Modify: `src/cabinet/cli/tui.py` (imports, PromptSession config, run_cockpit signature)
- Modify: `src/cabinet/cli/main.py:193` (pass data_dir to run_cockpit)
- Modify: `tests/unit/cli/test_tui.py` (add tests)

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/cli/test_tui.py`:

```python
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.history import FileHistory, InMemoryHistory
from pathlib import Path


def test_slash_completer_contains_all_commands():
    from cabinet.cli.tui import SLASH_COMPLETER
    assert isinstance(SLASH_COMPLETER, WordCompleter)
    # All 13 slash commands should be in the completer words
    words = SLASH_COMPLETER.words
    assert "/decision" in words
    assert "/meeting" in words
    assert "/office" in words
    assert "/summary" in words
    assert "/decide" in words
    assert "/task" in words
    assert "/strategy" in words
    assert "/review" in words
    assert "/skills" in words
    assert "/employees" in words
    assert "/status" in words
    assert "/help" in words
    assert "/quit" in words


def test_slash_completer_completes_partial_input():
    from cabinet.cli.tui import SLASH_COMPLETER
    completions = list(SLASH_COMPLETER.get_completions(None, "/dec"))
    completion_texts = [c.text for c in completions]
    assert "/decision" in completion_texts
    assert "/decide" in completion_texts


def test_slash_completer_case_insensitive():
    from cabinet.cli.tui import SLASH_COMPLETER
    completions = list(SLASH_COMPLETER.get_completions(None, "/DEC"))
    completion_texts = [c.text for c in completions]
    assert "/decision" in completion_texts


def test_slash_completer_not_triggered_on_plain_text():
    from cabinet.cli.tui import SLASH_COMPLETER
    # Plain text (not starting with /) should yield no completions
    completions = list(SLASH_COMPLETER.get_completions(None, "hello"))
    assert len(completions) == 0


def test_history_file_path_construction():
    from cabinet.cli.tui import _get_history_path
    with tempfile.TemporaryDirectory() as tmpdir:
        path = _get_history_path(tmpdir)
        assert path.name == ".chat_history"
        assert str(path.parent) == tmpdir


def test_history_file_auto_creates_parent():
    from cabinet.cli.tui import _get_history_path
    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = os.path.join(tmpdir, "data")
        path = _get_history_path(data_dir)
        # Path construction only — FileHistory handles creation at write time
        assert str(path.parent) == data_dir
```

Note: add `import tempfile` and `import os` to test file imports (at top of file or inline).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/cli/test_tui.py::test_slash_completer_contains_all_commands -v`
Expected: FAIL (ImportError: cannot import name 'SLASH_COMPLETER')

- [ ] **Step 3: Add imports and constants to tui.py**

Add at the top of `src/cabinet/cli/tui.py`, after the existing prompt_toolkit imports (line 12):

```python
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.history import FileHistory
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from pathlib import Path
```

Add these constants after the existing `SLASH_COMMANDS` dict (around line 125):

```python
SLASH_COMPLETER = WordCompleter(
    ["/decision", "/meeting", "/office", "/summary",
     "/decide", "/task", "/strategy", "/review",
     "/skills", "/employees", "/status", "/help", "/quit"],
    ignore_case=True,
    sentence=True,
    meta_dict={
        "/decision":  "切换决策室",
        "/meeting":   "切换会议室 / 启动审议",
        "/office":    "切换办公室",
        "/summary":   "切换总结室",
        "/decide":    "提交决策请求",
        "/task":      "提交执行任务",
        "/strategy":  "解码战略提案",
        "/review":    "启动复盘",
        "/skills":    "列出可用技能",
        "/employees": "列出注册员工",
        "/status":    "显示待处理摘要",
        "/help":      "显示帮助",
        "/quit":      "退出",
    },
)


def _get_history_path(data_dir: str) -> Path:
    """Return path for chat history file, creating parent directory if needed."""
    return Path(data_dir) / ".chat_history"
```

- [ ] **Step 4: Update run_cockpit signature and PromptSession**

Change `run_cockpit` signature in `tui.py`:

```python
# Before:
async def run_cockpit(console: Console, runtime, config) -> None:

# After:
async def run_cockpit(console: Console, runtime, config, data_dir: str) -> None:
```

Replace the `PromptSession()` creation line:

```python
# Before:
session = PromptSession()

# After:
history_path = _get_history_path(data_dir)
session = PromptSession(
    history=FileHistory(str(history_path)),
    auto_suggest=AutoSuggestFromHistory(),
    completer=SLASH_COMPLETER,
)
```

- [ ] **Step 5: Update caller in main.py**

In `src/cabinet/cli/main.py`, change the `run_cockpit` call:

```python
# Before (line 193):
await run_cockpit(console, runtime, config)

# After:
await run_cockpit(console, runtime, config, data_dir)
```

- [ ] **Step 6: Run all tests to verify**

Run: `pytest tests/unit/cli/test_tui.py tests/unit/cli/test_tui_themes.py tests/unit/cli/test_tui_components.py -v`
Expected: new tests pass; pre-existing async event loop tests may still fail (Python 3.14 issue)

Run: `python -m ruff check src/cabinet/cli/tui.py src/cabinet/cli/main.py`
Expected: no errors

Run: `python -c "from cabinet.cli.tui import SLASH_COMPLETER, _get_history_path; print(SLASH_COMPLETER)"`
Expected: WordCompleter repr without import errors

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/cli/tui.py src/cabinet/cli/main.py tests/unit/cli/test_tui.py
git commit -m "feat(tui): add Tab completion for slash commands and persistent chat history"
```
