# TUI 彻底完成 — 完整设计方案（方案 C：Reactive 重构先行）

**Date**: 2026-05-07
**Status**: Approved
**Scope**: 完成 Textual TUI 迁移的剩余工作——Reactive 状态重构 → 功能补全 → 清理旧代码

## 1. Context

Textual 迁移处于 ~35% 完成度：基础框架（app.py, screens, widgets）已搭建，但以下核心问题未解决：

- InputArea widget 未连接到 CockpitScreen（raw `Input()` 替代了 `InputArea()`）
- 所有状态更新靠手动 `query_one("#id").update()`，而非 Textual 原生 `reactive` + `watch_*`
- 侧面板 `_sync_panels()` 从未被调用
- ThinkingPanel 从未接收数据
- 补全弹出框为空操作（`pass`）
- 键盘历史导航（↑↓）未实现
- 6 个斜杠命令缺失
- 会话计时器硬编码 "0:00"
- 旧代码未清理（tui.py, tui_components.py, prompt-toolkit 依赖）

## 2. Design Overview

**三阶段路线：**

```
阶段一 (2-3天)          阶段二 (3-4天)           阶段三 (2天)
─────────────          ─────────────          ────────────
Reactive 状态重构      功能补全                 清理收尾
├─ reactive 属性       ├─ InputArea 连接       ├─ 删除 tui.py
├─ watch_* 方法        ├─ 键盘历史导航          ├─ 删除 tui_components.py
├─ 会话计时器           ├─ 补全弹出框            ├─ 精简 tui_themes.py
├─ 去手动 update()     ├─ 模式感知 placeholder  ├─ 移除 prompt-toolkit
└─ state.py 精简       ├─ 侧面板连接            └─ 测试迁移
                       ├─ ThinkingPanel 解析
                       └─ 6 个斜杠命令
```

## 3. Phase 1: Reactive State Refactor

### 3.1 Core Change

`CockpitState` (dataclass) → `textual.reactive` class attributes on `CockpitScreen`.

```python
# cockpit.py
from textual.reactive import reactive

class CockpitScreen(Screen):
    mode: reactive[str] = reactive("decision")
    token_count: reactive[int] = reactive(0)
    elapsed_seconds: reactive[int] = reactive(0)
    secretary_message: reactive[str] = reactive("")
    secretary_urgent: reactive[bool] = reactive(False)
    captain_id: reactive[str] = reactive("")
    api_connected: reactive[bool] = reactive(True)

    conversation: reactive[list[dict]] = reactive(list)
    streaming_content: reactive[str] = reactive("")

    thinking_steps: reactive[list[str]] = reactive(list)
    thinking_expanded: reactive[bool] = reactive(False)

    meeting_topic: reactive[str] = reactive("")
    meeting_advisors: reactive[int] = reactive(0)
    meeting_round: reactive[int] = reactive(0)
    decision_red: reactive[int] = reactive(0)
    decision_yellow: reactive[int] = reactive(0)
    decision_blue: reactive[int] = reactive(0)
    office_workflow: reactive[str] = reactive("")
    office_progress: reactive[float] = reactive(0.0)
    office_current_node: reactive[str] = reactive("")
```

### 3.2 watch_* Auto-Update Chain

Each reactive attribute has a corresponding `watch_*` method. Textual automatically triggers these on change — no more manual `query_one("#id").update()`:

| Attribute | watch method | Auto-updates |
|-----------|-------------|--------------|
| `mode` | `watch_mode` | Header (mode label) + Input placeholder |
| `token_count` | `watch_token_count` | Header (token count) |
| `elapsed_seconds` | `watch_elapsed_seconds` | Header (session time) |
| `secretary_message` | `watch_secretary_message` | SecretaryBar text |
| `secretary_urgent` | `watch_secretary_urgent` | SecretaryBar CSS class `.urgent` |
| `thinking_steps` | `watch_thinking_steps` | ThinkingPanel content |
| `thinking_expanded` | `watch_thinking_expanded` | ThinkingPanel expand/collapse |
| `meeting_topic` | `watch_meeting_topic` | MeetingPanel via `_sync_panels()` |
| `decision_red` | `watch_decision_red` | DecisionPanel via `_sync_panels()` |
| `office_workflow` | `watch_office_workflow` | OfficePanel via `_sync_panels()` |

```python
def watch_mode(self, old: str, new: str) -> None:
    header = self.query_one("#header", Header)
    header.update_info(self.token_count, self._format_elapsed(), new)
    self._sync_panels()

def watch_secretary_message(self, old: str, new: str) -> None:
    bar = self.query_one("#secretary-bar", Static)
    bar.update(f"📋 秘书：{new}" if new else "📋 秘书：Captain，一切正常")

def watch_secretary_urgent(self, old: bool, new: bool) -> None:
    bar = self.query_one("#secretary-bar", Static)
    if new:
        bar.add_class("urgent")
    else:
        bar.remove_class("urgent")

def watch_thinking_steps(self, old, new) -> None:
    self.query_one("#thinking-panel", ThinkingPanel).update_state(
        new, self.thinking_expanded
    )

def watch_thinking_expanded(self, old, new) -> None:
    self.query_one("#thinking-panel", ThinkingPanel).update_state(
        self.thinking_steps, new
    )
```

### 3.3 Session Timer

```python
def on_mount(self) -> None:
    self.set_interval(1, self._tick)
    self._greet()

def _tick(self) -> None:
    self.elapsed_seconds += 1

def _format_elapsed(self) -> str:
    h, rem = divmod(self.elapsed_seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"
```

### 3.4 `_greet()` Simplified

No more manual `query_one().update()` — just set reactive attributes:

```python
async def _greet(self) -> None:
    try:
        greeting = await self.runtime.secretary.greet(
            captain_id=self.config.organization.captain_id
        )
        self.captain_id = self.config.organization.captain_id
        self.secretary_message = greeting.message  # watch auto-updates UI
    except Exception:
        self.secretary_message = "秘书服务连接失败"
```

### 3.5 state.py

`CockpitState` dataclass is deleted. `side_panels.py` signatures change to accept individual field values instead of `CockpitState` object. `state.py` becomes a thin re-export or is removed entirely.

## 4. Phase 2: Feature Completion

### 4.1 InputArea Connection

In `CockpitScreen.compose()`, replace `yield Input(placeholder="decision > ", id="prompt-input")` with:

```python
yield InputArea(data_dir=self.data_dir, id="input-area")
```

### 4.2 Keyboard History Navigation (↑↓)

```python
class InputArea(Vertical):
    BINDINGS = [
        ("up", "history_prev", "Previous"),
        ("down", "history_next", "Next"),
    ]

    def action_history_prev(self) -> None:
        if not self._history:
            return
        if self._history_index < len(self._history) - 1:
            self._history_index += 1
        idx = len(self._history) - 1 - self._history_index
        inp = self.query_one("#prompt-input", Input)
        inp.value = self._history[idx]
        inp.cursor_position = len(inp.value)

    def action_history_next(self) -> None:
        if self._history_index <= 0:
            self._history_index = -1
            self.query_one("#prompt-input", Input).value = ""
            return
        self._history_index -= 1
        idx = len(self._history) - 1 - self._history_index
        self.query_one("#prompt-input", Input).value = self._history[idx]
```

### 4.3 Completion Popup

Replace `pass` stubs with a `ListView` overlay:

```python
def compose(self) -> ComposeResult:
    yield ListView(id="completion-list", classes="completion-overlay")
    yield Input(placeholder="decision > ", id="prompt-input")

def on_input_changed(self, event: Input.Changed) -> None:
    value = event.value or ""
    if value.startswith("/"):
        matches = _filter_completions(value)
        if matches:
            self._show_completions(matches)
            return
    self._hide_completions()

def _show_completions(self, matches: list[str]) -> None:
    lv = self.query_one("#completion-list", ListView)
    lv.clear()
    for m in matches:
        desc = SLASH_COMMAND_DESCRIPTIONS.get(m, "")
        lv.append(ListItem(Static(f"{m}  {desc}")))
    lv.display = True
    self._completion_visible = True

def _hide_completions(self) -> None:
    self.query_one("#completion-list", ListView).display = False
    self._completion_visible = False

def on_list_view_selected(self, event: ListView.Selected) -> None:
    text = str(event.item.query_one(Static).renderable)
    cmd = text.split()[0]
    inp = self.query_one("#prompt-input", Input)
    inp.value = cmd + " "
    inp.cursor_position = len(inp.value)
    self._hide_completions()
```

### 4.4 Mode-Aware Placeholder

```python
class InputArea(Vertical):
    PLACEHOLDERS = {
        "decision": "decision > ",
        "meeting": "meeting > ",
        "office": "office > ",
        "summary": "summary > ",
    }

    def set_placeholder(self, mode: str) -> None:
        placeholder = self.PLACEHOLDERS.get(mode, f"{mode} > ")
        self.query_one("#prompt-input", Input).placeholder = placeholder
```

### 4.5 Side Panels Connection

`_sync_panels()` already exists but is never called. It gets called from `watch_*` methods. Signatures decoupled from `CockpitState`:

```python
# side_panels.py
class MeetingPanel(Vertical):
    def update_state(self, topic: str, advisors: int, round_num: int) -> None: ...

class DecisionPanel(Vertical):
    def update_state(self, red: int, yellow: int, blue: int) -> None: ...

class OfficePanel(Vertical):
    def update_state(self, workflow: str, progress: float, current_node: str) -> None: ...

# cockpit.py
def _sync_panels(self) -> None:
    self.query_one("#meeting-panel", MeetingPanel).update_state(
        self.meeting_topic, self.meeting_advisors, self.meeting_round
    )
    self.query_one("#decision-panel", DecisionPanel).update_state(
        self.decision_red, self.decision_yellow, self.decision_blue
    )
    self.query_one("#office-panel", OfficePanel).update_state(
        self.office_workflow, self.office_progress, self.office_current_node
    )
```

### 4.6 ThinkingPanel Parsing

Parse `<thinking>` tags from streaming response:

```python
import re
THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL)

# In _stream_chat, after collecting chunks:
final_text = "".join(chunks)
m = THINKING_RE.search(final_text)
if m:
    steps = [s.strip() for s in m.group(1).split("\n") if s.strip()]
    self.thinking_steps = steps  # watch auto-updates ThinkingPanel
    final_text = THINKING_RE.sub("", final_text).strip()
```

### 4.7 Missing Slash Commands

Add to `_handle_slash_command`:

```python
def _handle_slash_command(self, text: str) -> None:
    parts = text.split(maxsplit=1)
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else ""

    if cmd in ("/decision", "/meeting", "/office", "/summary"):
        self.mode = cmd.lstrip("/")
        self.secretary_message = f"已切换至{mode_names[self.mode]}"
    elif cmd == "/decide" and arg:
        self.run_worker(self._execute_slash_intent("decision", arg))
    elif cmd == "/task" and arg:
        self.run_worker(self._execute_slash_intent("office", arg))
    elif cmd == "/strategy" and arg:
        self.run_worker(self._execute_slash_intent("decision", arg))
    elif cmd == "/review":
        self.mode = "summary"
        self.run_worker(self._stream_chat("请启动项目复盘"))
    elif cmd == "/skills":
        self._show_skills()
    elif cmd == "/employees":
        self._show_employees()
    elif cmd == "/status":
        self.run_worker(self._handle_status())
    elif cmd == "/help":
        self._show_help()
    else:
        self.secretary_message = f"未知命令: {cmd}，输入 /help 查看帮助"
```

`_show_skills()` reads from `self.runtime.tool_registry._skills`; `_show_employees()` reads from `self.runtime.employee_store.list_all()`.

## 5. Phase 3: Cleanup

### 5.1 Files to Delete

| File | Reason |
|------|--------|
| `src/cabinet/cli/tui.py` | 57-line shim, only re-exports + prompt_toolkit `SLASH_COMPLETER` |
| `src/cabinet/cli/tui_components.py` | 228 lines of Rich rendering, replaced by Textual widgets |

### 5.2 Files to Modify

| File | Change |
|------|--------|
| `src/cabinet/cli/tui_themes.py` | Remove `prompt_toolkit.styles.Style` `INPUT_STYLE`; keep `CABINET_*` colors and `CABINET_LOGO` |
| `pyproject.toml` | Remove `"prompt-toolkit>=3.0"` dependency |
| `src/cabinet/cli/cockpit.tcss` | Add styles for completion list overlay, user/assistant messages, urgent state |

### 5.3 Test Migration

| Old File | Action |
|----------|--------|
| `tests/unit/cli/test_tui.py` | Rewrite as `test_cockpit.py` — test reactive defaults, `watch_*` callbacks, slash commands, `_split_thinking_steps` |
| `tests/unit/cli/test_tui_components.py` | Delete (tests Rich render functions, no longer exist) |
| `tests/unit/cli/test_widgets_input_area.py` | Expand — add `test_history_navigation`, `test_completion_popup_show_hide`, `test_list_view_selected` |
| `tests/unit/cli/test_intent.py` | Keep, deduplicate from test_tui.py |
| `tests/unit/cli/test_tui_themes.py` | Update — test only kept color constants and `CABINET_LOGO` |

## 6. CSS Additions (cockpit.tcss)

```css
#completion-list {
    display: none;
    height: auto;
    max-height: 12;
    border: solid #3B82F6;
    background: #1a1a2e;
}

.completion-overlay {
    overlay: screen;
    dock: bottom;
}

.user-message {
    color: #64748B;
    text-align: right;
}

.assistant-message {
    color: #E2E8F0;
}

#secretary-bar.urgent {
    color: #CB220C;
    text-style: bold;
}
```

## 7. File Change Summary

```
Delete (2):
  src/cabinet/cli/tui.py
  src/cabinet/cli/tui_components.py

Modify (8):
  src/cabinet/cli/screens/cockpit.py     reactive refactor + watch_* + slash commands + timer
  src/cabinet/cli/state.py               simplify to compat re-export or remove
  src/cabinet/cli/widgets/input_area.py  completion popup + history navigation + placeholder
  src/cabinet/cli/widgets/side_panels.py decouple CockpitState → field params
  src/cabinet/cli/tui_themes.py          remove prompt_toolkit INPUT_STYLE
  src/cabinet/cli/cockpit.tcss           completion + messages + urgent styles
  pyproject.toml                         remove prompt-toolkit dependency

Test changes:
  Delete: tests/unit/cli/test_tui_components.py
  Rewrite: tests/unit/cli/test_tui.py → test_cockpit.py
  Expand: tests/unit/cli/test_widgets_input_area.py
  Update: tests/unit/cli/test_tui_themes.py
```

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| `reactive(list)` / `reactive(dict)` mutable default conflict | Use factory form `reactive(list)` not `reactive([])` |
| Deleting `tui.py` breaks external imports | Grep full project for residual imports before deletion |
| `<thinking>` regex parsing affects normal output | Extract then remove; do not alter main streaming logic |
| `set_interval` persists after Screen destroy | Textual auto-cleans timers on Screen unmount |
