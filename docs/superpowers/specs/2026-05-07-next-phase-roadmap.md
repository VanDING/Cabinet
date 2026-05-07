# Next Phase Development Roadmap

**Date**: 2026-05-07
**Status**: Approved
**Scope**: Post-MVP product experience + quality engineering, 4 phases over ~5 weeks

## Context

Cabinet MVP is complete: 966 tests, 6 rooms, 28+ API endpoints, 11 CLI commands, all 8 MVP deliverables met. Codebase is clean (zero TODOs). TUI UX fixes (6 bugs) just merged.

This roadmap covers the next development phase: Product Experience (TUI polish) + Quality Engineering (CI/CD, integration tests, performance).

## Phase Overview

| Week | Focus | Deliverable | Files |
|------|-------|-------------|-------|
| 1 | TUI: Tab completion + command history | WordCompleter, FileHistory, Ctrl+R search | `tui.py` (~80 lines) |
| 2 | CI/CD Pipeline | GitHub Actions: lint + test on push/PR | `.github/workflows/ci.yml` |
| 3-4 | Integration/E2E tests | 32 → 50+ integration tests, cross-room flows | `tests/integration/` |
| 4-5 | Performance & stability | Benchmarks, memory profiling, 1hr soak test | `tests/load/`, scripts |

Each phase produces independently testable, shippable output.

## Phase 1: Tab Completion + Command History

### Problem
Users in `cabinet chat` must type slash commands from memory. No autocomplete, no history recall. The `/help` command is the only reference.

### Solution
Leverage prompt_toolkit's built-in `WordCompleter`, `FileHistory`, and `AutoSuggestFromHistory`.

**Slash command completion:**
- `/` triggers completions for all 13 slash commands
- Partial input like `/dec` auto-completes to `/decision`
- Sub-commands: `/decide ` shows `STRATEGIC OPERATIONAL TACTICAL`

**Command history:**
- History persisted to `data/.chat_history` (one command per line)
- ↑/↓ to browse, Ctrl+R for reverse search
- Auto-suggest from history (greyed-out ghost text)

### Implementation

**File**: `src/cabinet/cli/tui.py` only (~80 lines)

```python
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.history import FileHistory
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from pathlib import Path

SLASH_COMPLETER = WordCompleter(
    ["/decision", "/meeting", "/office", "/summary",
     "/decide", "/task", "/strategy", "/review",
     "/skills", "/employees", "/status", "/help", "/quit"],
    ignore_case=True,
    sentence=True,   # only complete first word
    meta_dict={      # brief descriptions shown in completion menu
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
```

**PromptSession changes:**
```python
history_path = Path(config.data_dir) / ".chat_history"
history_path.parent.mkdir(parents=True, exist_ok=True)

session = PromptSession(
    history=FileHistory(str(history_path)),
    auto_suggest=AutoSuggestFromHistory(),
    completer=SLASH_COMPLETER,
)
```

**Scope note**: Week 1 implements slash command completion + history. Sub-command completion (e.g., `/decide STRATEGIC`) is deferred to a follow-up — it adds complexity (custom `Completer` subclass) without blocking the core UX win.

## Phase 2: CI/CD Pipeline

> Detailed spec to be written during Week 1.

- GitHub Actions workflow: `ci.yml`
- Triggers: push to master, PR to master
- Jobs: lint (ruff), test (pytest 3.12+3.13 matrix), type check (mypy optional)
- Status badges in README

## Phase 3: Integration/E2E Tests

> Detailed spec to be written during Week 2.

- Current state: 32 integration tests vs 934 unit tests (1:30 ratio)
- Target: 50+ integration tests
- Focus areas:
  - Cross-room event flows (meeting → decision → office pipeline)
  - API end-to-end (auth → request → response validation)
  - CLI integration (init → chat → verify state)

## Phase 4: Performance & Stability

> Detailed spec to be written during Week 3.

- Load test scripts for API (existing `bench_api.py` — expand)
- Memory profiling via `tracemalloc` or `memory-profiler`
- 1-hour continuous operation soak test
- Concurrent user simulation (WebSocket connections)
