# CLI TUI 驾驶舱设计文档

## 概述

将 `cabinet chat` 命令的现有简单对话界面，升级为"Captain 驾驶舱"式的多面板终端界面。本次实施范围为**最小可用版本**：欢迎屏 Logo 渲染 + 颜色规范 + 驾驶舱基础布局 + 斜杠命令路由 + 占位内容。

## 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 数据缺口处理 | TUI 层模拟数据 | 不触碰业务代码，交付快 |
| 输入方案 | prompt_toolkit | 支持历史、补全、与 Live 无缝集成 |
| 欢迎屏交互 | 原生按键检测 | 简单，跨平台差异在函数内封装 |
| 实施范围 | 最小可用 | 先跑通基础布局，后续迭代 |
| 代码架构 | 方案 B 组件拆分 | 职责清晰可扩展，不过度设计 |

## 1. 文件结构与模块职责

```
src/cabinet/cli/
├── __init__.py          # 不变
├── config.py            # 不变
├── main.py              # 修改：_chat_async 替换为 TUI 入口
├── tui.py               # 新增：主循环、Layout 组装、输入路由
├── tui_themes.py        # 新增：颜色常量、Style 定义、Logo 常量
└── tui_components.py    # 新增：各面板渲染函数
```

| 模块 | 职责 | 依赖 |
|---|---|---|
| `tui_themes.py` | 颜色常量、Style 对象、`CABINET_LOGO` 常量 | rich.style |
| `tui_components.py` | 纯渲染函数：每个函数接收数据参数，返回 Rich Renderable | rich.text, rich.panel, rich.table, rich.progress, tui_themes |
| `tui.py` | `CockpitState` 数据类、`run_welcome_screen()`、`run_cockpit()` 主循环 | rich.live, rich.layout, prompt_toolkit, tui_components, tui_themes |
| `main.py` | `_chat_async()` 改为调用 `tui.run_welcome_screen()` → `tui.run_cockpit()` | tui |

**关键原则**：
- `tui_components.py` 中的函数是**纯函数**——接收数据，返回 Renderable，无副作用
- `tui.py` 是唯一的**有状态模块**——管理 CockpitState、Live 循环、输入处理
- `tui_themes.py` 零外部依赖（仅 rich.style）——颜色规范的唯一来源

## 2. 颜色规范与主题系统 (`tui_themes.py`)

### 颜色常量

| 名称 | 值 | 用途 |
|---|---|---|
| `CABINET_BLUE` | `#081D60` | 重点色：顶栏模式标签、输入提示符、主面板标题边框、蓝色决策卡片、进度条、CABINET 文字 |
| `CABINET_RED` | `#CB220C` | 警告色：紧急通知、红色决策卡片、错误提示、高优先级事项、Logo 色块 |
| `CABINET_YELLOW` | `#EDB61B` | 待定色：黄色决策卡片、待处理事项标记、Logo 色块 |

### Style 对象

```python
STYLE_DEFAULT = Style(color="white")
STYLE_BLUE_BOLD = Style(color=CABINET_BLUE, bold=True)
STYLE_RED_BOLD = Style(color=CABINET_RED, bold=True)
STYLE_YELLOW_BOLD = Style(color=CABINET_YELLOW, bold=True)
STYLE_DIM = Style(color="grey62", dim=True)
STYLE_BLUE = Style(color=CABINET_BLUE)
```

### Logo 常量

直接使用用户提供的 Rich 标记语言格式，不做二次转换：

```python
CABINET_LOGO = """
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #081D60]████████████████████████████[/]
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #081D60]████████████████████████████[/]
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #081D60]████████████████████████████[/]
                        [bold #081D60]████████████████████████████[/]
[white]██████████████[/]    [white]██████████████[/]    [bold #081D60]████████████████████████████[/]
[white]██████████████[/]    [white]██████████████[/]    [bold #081D60]████████████████████████████[/]

[bold #081D60]██████╗  █████╗ ██████╗ ██╗███╗   ██╗███████╗████████╗[/]
[bold #081D60]██╔════╝ ██╔══██╗██╔══██╗██║████╗  ██║██╔════╝╚══██╔══╝[/]
[bold #081D60]██║  ███╗███████║██████╔╝██║██╔██╗ ██║█████╗     ██║[/]
[bold #081D60]██║   ██║██╔══██║██╔══██╗██║██║╚██╗██║██╔══╝     ██║[/]
[bold #081D60]╚██████╔╝██║  ██║██████╔╝██║██║ ╚████║███████╗   ██║[/]
[bold #081D60]╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝[/]
"""
```

**使用规则**：任何需要颜色的地方必须引用 `tui_themes` 中的常量或 Style，不得硬编码颜色值。Rich 标记语言中可直接使用 hex 值（如 `[bold #081D60]`），但需与常量保持一致。

## 3. 欢迎屏流程

### 流程

```
_chat_async() 启动
    │
    ▼
run_welcome_screen(console, runtime)
    │
    ├─ 构建欢迎屏 Renderable（Logo + 版本信息 + 问候语）
    ├─ Live(welcome_renderable, auto_refresh=False).start()
    │   └─ 渲染一次，然后静止等待
    ├─ _wait_for_keypress()
    │   ├─ Windows: msvcrt.getch()
    │   └─ Unix: sys.stdin.read(1) + tty.setcbreak
    ├─ Live.stop()
    └─ 返回，进入 run_cockpit()
```

### 渲染结构

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              [彩色色块图案 - CABINET_LOGO]            │
│                                                     │
│              [CABINET ASCII 艺术字 - 蓝色]            │
│                                                     │
│           v0.1.0 · AI Collaboration Framework        │  ← 灰色 dim
│                                                     │
│            Captain，欢迎登上 Cabinet                  │  ← 白色
│                                                     │
│         Press any key to enter the cockpit...        │  ← 灰色 dim
│                                                     │
│     ⚠ API 连接失败，请检查配置  (仅连接失败时显示)      │  ← 红色 #CB220C
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 关键实现细节

1. **居中渲染**：使用 `rich.align.Align` 包裹整个欢迎屏内容，`align="center"`，垂直居中使用空白填充
2. **API 连接检测**：调用 `runtime.health_check()` 的 LLM 网关部分，失败则追加红色警告行
3. **按键检测**：封装为 `_wait_for_keypress()` 函数，内部处理 Windows/Unix 差异
4. **Live 配置**：`auto_refresh=False`，只渲染一次后静止

### 代码骨架

```python
async def run_welcome_screen(console: Console, runtime: CabinetRuntime) -> None:
    welcome = _build_welcome_renderable(runtime)
    with Live(welcome, console=console, auto_refresh=False, vertical_overflow="visible") as live:
        live.update(welcome, refresh=True)
        _wait_for_keypress()
```

## 4. 驾驶舱布局与 Live 循环

### Layout 树结构

```
Layout("root")
├── Layout("top_bar", size=1)           ← 顶栏：Token | Session | 模式标签
├── Layout("secretary_bar", size=1)     ← 秘书通知栏
└── Layout("main", ratio=1)             ← 主区域（占满剩余高度）
    ├── Layout("left", ratio=65)        ← 左侧交互区
    │   ├── Layout("content", ratio=1)  ← 模式内容（决策卡片/会议/任务等）
    │   └── Layout("input", size=1)     ← 输入提示符行
    └── Layout("right", ratio=35)       ← 右侧监控面板
        ├── Layout("meeting_panel", ratio=1)   ← 会议室
        ├── Layout("decision_panel", ratio=1)  ← 决策室
        └── Layout("office_panel", ratio=1)    ← 办公室
```

### 渲染效果示意

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Token: 1.2K │ Session: 0:03:21 │ 🧭 决策室 (Decision)                  │  ← 顶栏
├──────────────────────────────────────────────────────────────────────────┤
│ 📋 秘书：Captain，当前有 2 项紧急决策待处理                               │  ← 秘书通知栏
├─────────────────────────────────────────┬────────────────────────────────┤
│                                         │  ┌─ 会议室 ─────────────────┐ │
│  🔴 [决策卡片] 供应商合同续签             │  │ 议题: Q3 预算分配         │ │
│     紧急 · 需 Captain 批准               │  │ 顾问: 3 · 轮次: 2/3       │ │
│                                         │  └──────────────────────────┘ │
│  🟡 [决策卡片] 技术栈升级评估             │  ┌─ 决策室 ─────────────────┐ │
│     待定 · 2 日内回复                     │  │ 🔴 2  🟡 3  🔵 5          │ │
│                                         │  └──────────────────────────┘ │
│  🔵 [决策卡片] 团队建设活动方案           │  ┌─ 办公室 ─────────────────┐ │
│     常规 · 本周内决定                     │  │ 工作流: 数据迁移           │ │
│                                         │  │ ████████░░░░ 65%          │ │
│                                         │  │ 当前: 验证阶段             │ │
│                                         │  └──────────────────────────┘ │
├─────────────────────────────────────────┤                                │
│ decision > _                            │                                │
└─────────────────────────────────────────┴────────────────────────────────┘
```

### CockpitState 数据类

```python
@dataclass
class CockpitState:
    mode: str = "decision"
    token_count: int = 0
    session_start: datetime = field(default_factory=datetime.now)
    secretary_message: str = ""
    secretary_urgent: bool = False
    api_connected: bool = True
    captain_id: str = ""
    # 右侧面板模拟数据
    meeting_topic: str = ""
    meeting_advisors: int = 0
    meeting_round: int = 0
    decision_red: int = 0
    decision_yellow: int = 0
    decision_blue: int = 0
    office_workflow: str = ""
    office_progress: float = 0.0
    office_current_node: str = ""
    # 左侧内容缓存
    left_content: RenderableType | None = None
    # 内部状态
    _ctrl_c_count: int = 0
```

### Live 循环核心逻辑

```python
async def run_cockpit(console: Console, runtime: CabinetRuntime, config) -> None:
    state = CockpitState()
    session = PromptSession()

    greeting = await runtime.secretary.greet(captain_id=config.organization.captain_id)
    state.secretary_message = greeting.message
    state.captain_id = config.organization.captain_id

    layout = _build_cockpit_layout(state)

    with Live(layout, console=console, refresh_per_second=1, vertical_overflow="visible") as live:
        refresh_task = asyncio.create_task(_periodic_refresh(state, runtime, live))

        try:
            while True:
                try:
                    user_input = await session.prompt_async(
                        HTML(f"<style fg='#081D60' bold>{state.mode} ></style> ")
                    )
                except KeyboardInterrupt:
                    if state._ctrl_c_count == 0:
                        state.secretary_message = "再次按 Ctrl+C 确认退出，或继续操作取消"
                        state.secretary_urgent = True
                        state._ctrl_c_count += 1
                        live.update(_build_cockpit_layout(state))
                        continue
                    else:
                        break
                except EOFError:
                    break

                stripped = user_input.strip()
                if not stripped:
                    continue
                if stripped == "/quit":
                    break

                state._ctrl_c_count = 0

                if stripped.startswith("/"):
                    await _handle_slash_command(stripped, state, runtime)
                else:
                    await _handle_chat(stripped, state, runtime, live)

                live.update(_build_cockpit_layout(state))
        finally:
            refresh_task.cancel()
```

### 关键设计决策

1. **`refresh_per_second=1`**：Live 以每秒 1 次频率刷新，足以更新顶栏时间和右侧面板
2. **`PromptSession.prompt_async()`**：prompt_toolkit 异步输入，不阻塞 Live 渲染
3. **右侧面板刷新**：`_periodic_refresh()` 每 3 秒更新模拟数据并调用 `live.update()`
4. **流式对话处理**：`_handle_chat()` 中流式输出时，临时将左侧内容设为流式文本，每收到 chunk 就 `live.update()`

## 5. 组件渲染函数 (`tui_components.py`)

所有函数为**纯函数**——接收数据参数，返回 Rich Renderable，无副作用。

### render_top_bar

```python
def render_top_bar(
    token_count: int,
    session_start: datetime,
    mode: str,
    mode_label: str,
) -> RenderableType:
```

- 左对齐 `Text` 对象
- `Token: {count}` → 白色，>1000 显示 `1.2K`
- `Session: {elapsed}` → 白色，计算 `datetime.now() - session_start`
- `🧭 {mode_label}` → 蓝色 `#081D60` 加粗
- 各段之间用 ` │ ` 分隔（灰色 dim）

### render_secretary_bar

```python
def render_secretary_bar(
    message: str,
    urgent: bool = False,
) -> RenderableType:
```

- 前缀 `📋 秘书：`
- 普通通知：白色
- 紧急通知：红色 `#CB220C` 加粗
- 无通知时显示默认：`📋 秘书：Captain，一切正常`

### render_left_panel

```python
def render_left_panel(
    mode: str,
    content: RenderableType | None = None,
) -> RenderableType:
```

- 根据 `mode` 选择标题和占位内容：

| mode | 标题 | 占位内容 |
|---|---|---|
| `decision` | 决策室 (Decision Chamber) | 暂无待处理决策 |
| `meeting` | 会议室 (Meeting Room) | 暂无活跃会议 |
| `office` | 办公室 (Office) | 暂无运行中的任务 |
| `summary` | 总结室 (Summary Room) | 暂无复盘报告 |

- 标题颜色：蓝色 `#081D60`

### render_meeting_panel

```python
def render_meeting_panel(
    topic: str = "",
    advisors: int = 0,
    round_num: int = 0,
    max_rounds: int = 3,
) -> RenderableType:
```

- Panel 标题：`会议室`，蓝色边框
- 有议题时：`议题: {topic}` + `顾问: {n} · 轮次: {r}/{max}`
- 无议题时：`Idle`（灰色 dim）

### render_decision_panel

```python
def render_decision_panel(
    red: int = 0,
    yellow: int = 0,
    blue: int = 0,
) -> RenderableType:
```

- Panel 标题：`决策室`，蓝色边框
- `🔴 {red}  🟡 {yellow}  🔵 {blue}`，数字分别用红/黄/蓝色
- 全为 0 时：`暂无待处理决策`（灰色 dim）

### render_office_panel

```python
def render_office_panel(
    workflow: str = "",
    progress: float = 0.0,
    current_node: str = "",
) -> RenderableType:
```

- Panel 标题：`办公室`，蓝色边框
- 有工作流时：工作流名称 + 进度条（蓝色 `#081D60`）+ 当前节点
- 无工作流时：`Idle`（灰色 dim）

### render_input_prompt

```python
def render_input_prompt(mode: str) -> RenderableType:
```

- `{mode} >` → 蓝色 `#081D60` 加粗

### 组件间数据流

```
CockpitState
    ├─→ render_top_bar(token_count, session_start, mode, mode_label)
    ├─→ render_secretary_bar(secretary_message, secretary_urgent)
    ├─→ render_left_panel(mode, left_content)
    ├─→ render_meeting_panel(meeting_topic, meeting_advisors, meeting_round)
    ├─→ render_decision_panel(decision_red, decision_yellow, decision_blue)
    ├─→ render_office_panel(office_workflow, office_progress, office_current_node)
    └─→ render_input_prompt(mode)
```

所有渲染函数只从 `CockpitState` 读取数据，不修改状态。状态变更仅在 `tui.py` 的命令处理函数中进行。

## 6. 斜杠命令路由与模式切换

### 命令路由表

```python
SLASH_COMMANDS: dict[str, str] = {
    "/decision": "decision",
    "/meeting":  "meeting",
    "/office":   "office",
    "/summary":  "summary",
    "/quit":     "__quit__",
    "/status":   "__status__",
    "/help":     "__help__",
}
```

### 模式标签映射

```python
MODE_LABELS: dict[str, str] = {
    "decision": "🧭 决策室 (Decision)",
    "meeting":  "🗣️ 会议室 (Meeting)",
    "office":   "📋 办公室 (Office)",
    "summary":  "📊 总结室 (Summary)",
}
```

### 命令处理流程

```
用户输入
    │
    ├─ 以 / 开头？
    │   ├─ 是 → 查 SLASH_COMMANDS
    │   │   ├─ 模式切换命令 (/decision, /meeting, /office, /summary)
    │   │   │   └─ 更新 state.mode → 更新顶栏标签 → 更新输入提示符 → 更新左侧占位内容
    │   │   ├─ /status → 调用 runtime.secretary.summarize_pending() → 更新秘书通知栏
    │   │   ├─ /help → 在左侧面板显示帮助信息
    │   │   └─ /quit → 退出主循环
    │   └─ 否 → 默认流式对话
    │       └─ 调用 runtime.secretary.process_input_stream() → 流式更新左侧内容
```

### 带参数的命令

现有 `_chat_async` 中的带参数命令在 MVP 阶段保留功能，输出显示在左侧面板：

- `/meeting <topic>` → 自动切换到 meeting 模式，调用 `runtime.meeting.start_session()`
- `/decide <title>` → 自动切换到 decision 模式，调用 `runtime.decision.submit()`
- `/task <desc>` → 自动切换到 office 模式，调用 `runtime.office.submit_task()`
- `/strategy <proposal>` → 调用 `runtime.strategy.decode()`
- `/review` → 切换到 summary 模式，调用 `runtime.summary.start_review()`
- `/skills` → 在左侧面板显示技能列表
- `/employees` → 在左侧面板显示员工列表

### 模式切换时的状态变更

```python
async def _handle_slash_command(raw: str, state: CockpitState, runtime: CabinetRuntime) -> None:
    cmd = raw.split()[0]

    # 带参数的命令：先切换模式，再执行业务逻辑
    if raw.startswith("/meeting "):
        state.mode = "meeting"
        topic = raw[len("/meeting "):]
        result = await runtime.meeting.start_session(
            topic=topic, level=MeetingLevel.STANDARD,
            participants=[], project_id=None,
        )
        state.left_content = Markdown(f"会议已启动: {result.session_id}")
        state.meeting_topic = topic
        return
    if raw.startswith("/decide "):
        state.mode = "decision"
        title = raw[len("/decide "):]
        result = await runtime.decision.submit(
            DecisionRequest(title=title, description="", urgency="normal")
        )
        state.left_content = Markdown(f"决策已提交: {result.id}")
        return
    if raw.startswith("/task "):
        state.mode = "office"
        desc = raw[len("/task "):]
        result = await runtime.office.submit_task(
            TaskOrder(description=desc, priority="normal")
        )
        state.left_content = Markdown(f"任务已提交: {result.id}")
        return
    if raw.startswith("/strategy "):
        proposal = raw[len("/strategy "):]
        result = await runtime.strategy.decode(proposal=proposal)
        state.left_content = Markdown(result.output)
        return
    if raw == "/review":
        state.mode = "summary"
        result = await runtime.summary.start_review(
            project_id=UUID("00000000-0000-0000-0000-000000000000"),
            review_type=ReviewType.SPRINT,
        )
        state.left_content = Markdown(f"复盘已启动: {result.id}")
        return
    if raw == "/skills":
        skills = runtime.tool_registry.list_tools()
        state.left_content = _build_skills_renderable(skills)
        return
    if raw == "/employees":
        employees = runtime.agent_pool.list_agents()
        state.left_content = _build_employees_renderable(employees)
        return

    # 纯模式切换命令
    mode = SLASH_COMMANDS.get(cmd)
    if mode and mode not in ("__quit__", "__status__", "__help__"):
        state.mode = mode
        state.left_content = None

    elif mode == "__status__":
        result = await runtime.secretary.summarize_pending(captain_id=state.captain_id)
        state.secretary_message = result.digest
        state.secretary_urgent = result.urgent_count > 0

    elif mode == "__help__":
        state.left_content = _build_help_renderable()
```

### 流式对话处理

```python
async def _handle_chat(
    user_input: str,
    state: CockpitState,
    runtime: CabinetRuntime,
    live: Live,
) -> None:
    context = InteractionContext(
        captain_id=state.captain_id,
        channel="terminal",
    )
    response = await runtime.secretary.process_input_stream(
        captain_input=user_input,
        context=context,
    )

    chunks: list[str] = []
    async for chunk in response.stream:
        chunks.append(chunk)
        state.left_content = Markdown("".join(chunks))
        live.update(_build_cockpit_layout(state))

    await response.finalize()
    if hasattr(response, 'usage') and response.usage:
        state.token_count += response.usage.get("total_tokens", 0)
```

## 7. main.py 集成与错误处理

### _chat_async 改造

```python
async def _chat_async(data_dir: str) -> None:
    runtime, config = await _init_runtime(data_dir)
    try:
        await run_welcome_screen(console, runtime)
        await run_cockpit(console, runtime, config)
    finally:
        await runtime.stop()
```

**变更**：
- 删除原有 `Prompt.ask()` 循环和 `if/elif` 命令分发
- 删除原有 `Panel(greeting.message, title="Secretary")` 欢迎语
- 保留 `_init_runtime()` 不变
- 保留 `runtime.stop()` 在 finally 中
- `console` 对象传递给 TUI 函数

**保留不变**：
- `_init_runtime()`
- 所有非 chat 命令（`serve`、`backup`、`migrate` 等）
- `app` Typer 实例和所有 `@app.command()` 装饰器
- `console = Console()` 全局实例

### 错误处理

| 场景 | 处理方式 |
|---|---|
| API 连接失败 | 欢迎屏显示红色警告，进入驾驶舱后秘书通知栏显示错误 |
| 流式对话异常 | 左侧面板显示错误信息（红色），不中断主循环 |
| 斜杠命令异常 | 左侧面板显示错误信息（红色），不中断主循环 |
| Runtime 初始化失败 | 在欢迎屏之前抛出，由 main.py 的 typer 处理 |
| Ctrl+C | 第一次显示确认提示，第二次退出 |
| Ctrl+D (EOFError) | 等同于 `/quit`，退出主循环 |
| 终端窗口过小 | 不做特殊处理，Rich 自动截断溢出内容 |

### 依赖变更

`pyproject.toml` 新增：

```toml
"prompt-toolkit>=3.0"
```

不新增 `pyfiglet`——Logo 直接使用 Rich 标记语言常量。

## 8. 后台刷新任务

```python
async def _periodic_refresh(
    state: CockpitState,
    runtime: CabinetRuntime,
    live: Live,
) -> None:
    while True:
        await asyncio.sleep(3)
        try:
            # MVP 阶段：使用模拟数据
            # 后续迭代：替换为真实 API 调用
            # dashboard = await runtime.decision.get_dashboard(project_id=...)
            # state.decision_red = len(dashboard.red_cards)
            # state.decision_yellow = len(dashboard.yellow_cards)
            # state.decision_blue = len(dashboard.blue_cards)
            live.update(_build_cockpit_layout(state))
        except Exception:
            pass
```

MVP 阶段右侧面板使用模拟数据，数据在 `_periodic_refresh` 中可模拟变化（如进度条缓慢增长），后续迭代替换为真实 API 调用。

## 9. 不在 MVP 范围内的功能

以下功能留待后续迭代：

- 决策室模式的真实卡片渲染（调用 `get_dashboard()`）
- 会议室模式的议题输入框和推理过程流式输出
- 办公室模式的任务和工作流列表
- 总结室模式的复盘报告摘要
- 右侧面板真实数据绑定（替换模拟数据）
- 输入历史和 Tab 自动补全
- 多行输入编辑
- 终端窗口大小自适应
