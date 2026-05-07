from __future__ import annotations

import asyncio
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.history import FileHistory
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.key_binding import KeyBindings
from pathlib import Path
from rich.align import Align
from rich.console import Console, Group, RenderableType
from rich.layout import Layout
from rich.live import Live
from rich.markdown import Markdown
from rich.table import Table
from rich.text import Text

from cabinet.cli.tui_components import (
    render_decision_panel,
    render_input_prompt,
    render_left_panel,
    render_meeting_panel,
    render_office_panel,
    render_secretary_bar,
    render_thinking_block,
    render_top_bar,
)
from cabinet.cli.tui_themes import CABINET_BLUE, CABINET_LOGO, CABINET_RED, STYLE_DIM, STYLE_DEFAULT, INPUT_STYLE


@dataclass
class CockpitState:
    mode: str = "decision"
    token_count: int = 0
    session_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    secretary_message: str = ""
    secretary_urgent: bool = False
    api_connected: bool = True
    captain_id: str = ""
    meeting_topic: str = ""
    meeting_advisors: int = 0
    meeting_round: int = 0
    decision_red: int = 0
    decision_yellow: int = 0
    decision_blue: int = 0
    office_workflow: str = ""
    office_progress: float = 0.0
    office_current_node: str = ""
    left_content: RenderableType | None = None
    _ctrl_c_count: int = 0
    thinking_steps: list[str] = field(default_factory=list)
    thinking_expanded: bool = False


def _build_welcome_renderable(runtime) -> RenderableType:
    logo_text = Text.from_markup(CABINET_LOGO.strip())
    version_line = Text("v0.1.0 · AI Collaboration Framework", style=STYLE_DIM)
    greeting_line = Text("Captain，欢迎登上 Cabinet", style=STYLE_DEFAULT)
    prompt_line = Text("Press any key to enter the cockpit...", style=STYLE_DIM)

    elements = [
        Align.center(logo_text),
        Align.center(version_line),
        Align.center(Text()),
        Align.center(greeting_line),
        Align.center(Text()),
        Align.center(prompt_line),
    ]

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            health = None
        else:
            health = loop.run_until_complete(runtime.health_check())
    except Exception:
        health = None

    if health is not None and not getattr(health, "llm_gateway", True):
        warning = Text("⚠ API 连接失败，请检查配置", style=f"bold {CABINET_RED}")
        elements.append(Align.center(Text()))
        elements.append(Align.center(warning))

    return Group(*elements)


def _wait_for_keypress() -> None:
    if sys.platform == "win32":
        import msvcrt
        msvcrt.getch()
    else:
        import tty
        import termios
        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


async def run_welcome_screen(console: Console, runtime) -> None:
    welcome = _build_welcome_renderable(runtime)
    with Live(welcome, console=console, auto_refresh=False, vertical_overflow="visible") as live:
        live.update(welcome, refresh=True)
        _wait_for_keypress()


MODE_LABELS: dict[str, str] = {
    "decision": "🧭 决策室 (Decision)",
    "meeting": "🗣️ 会议室 (Meeting)",
    "office": "📋 办公室 (Office)",
    "summary": "📊 总结室 (Summary)",
}

SLASH_COMMANDS: dict[str, str] = {
    "/decision": "decision",
    "/meeting": "meeting",
    "/office": "office",
    "/summary": "summary",
    "/quit": "__quit__",
    "/status": "__status__",
    "/help": "__help__",
}

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
    """Return path for chat history file."""
    return Path(data_dir) / ".chat_history"


def _build_cockpit_layout(state: CockpitState) -> Layout:
    layout = Layout()

    layout.split(
        Layout(name="top_bar", size=1),
        Layout(name="secretary_bar", size=3),
        Layout(name="main", ratio=1),
    )

    layout["top_bar"].update(
        render_top_bar(
            token_count=state.token_count,
            session_start=state.session_start,
            mode=state.mode,
            mode_label=MODE_LABELS.get(state.mode, state.mode),
        )
    )

    layout["secretary_bar"].update(
        render_secretary_bar(
            message=state.secretary_message,
            urgent=state.secretary_urgent,
        )
    )

    layout["main"].split_row(
        Layout(name="left", ratio=65),
        Layout(name="right", ratio=35),
    )

    layout["main"]["left"].split(
        Layout(name="content", ratio=1),
        Layout(name="input", size=1),
    )

    # Composite thinking block (if any) with main content
    composite_content = state.left_content
    if state.thinking_steps:
        thinking_panel = render_thinking_block(state.thinking_steps, state.thinking_expanded)
        if composite_content is not None:
            composite_content = Group(thinking_panel, Text(), composite_content)
        else:
            composite_content = thinking_panel

    layout["main"]["left"]["content"].update(
        render_left_panel(mode=state.mode, content=composite_content)
    )

    layout["main"]["left"]["input"].update(
        render_input_prompt(mode=state.mode)
    )

    layout["main"]["right"].split(
        Layout(name="meeting_panel", ratio=1),
        Layout(name="decision_panel", ratio=1),
        Layout(name="office_panel", ratio=1),
    )

    layout["main"]["right"]["meeting_panel"].update(
        render_meeting_panel(
            topic=state.meeting_topic,
            advisors=state.meeting_advisors,
            round_num=state.meeting_round,
        )
    )

    layout["main"]["right"]["decision_panel"].update(
        render_decision_panel(
            red=state.decision_red,
            yellow=state.decision_yellow,
            blue=state.decision_blue,
        )
    )

    layout["main"]["right"]["office_panel"].update(
        render_office_panel(
            workflow=state.office_workflow,
            progress=state.office_progress,
            current_node=state.office_current_node,
        )
    )

    return layout


def _build_help_renderable() -> Table:
    table = Table(title="Available Commands")
    table.add_column("Command", style=f"bold {CABINET_BLUE}")
    table.add_column("Description", style="green")
    commands = [
        ("/decision", "切换到决策室模式"),
        ("/meeting", "切换到会议室模式"),
        ("/office", "切换到办公室模式"),
        ("/summary", "切换到总结室模式"),
        ("/meeting <topic>", "启动审议会话"),
        ("/decide <title>", "提交决策请求"),
        ("/task <desc>", "提交执行任务"),
        ("/strategy <proposal>", "解码战略提案"),
        ("/review", "启动复盘会话"),
        ("/skills", "列出可用技能"),
        ("/employees", "列出注册员工"),
        ("/status", "显示待处理摘要"),
        ("/help", "显示帮助"),
        ("/quit", "退出"),
    ]
    for cmd, desc in commands:
        table.add_row(cmd, desc)
    return table


async def _handle_slash_command(raw: str, state: CockpitState, runtime) -> None:
    if raw.startswith("/meeting "):
        state.mode = "meeting"
        topic = raw[len("/meeting "):]
        try:
            from cabinet.rooms.meeting.models import MeetingLevel
            result = await runtime.meeting.start_session(
                topic=topic, level=MeetingLevel.MULTI_PARTY,
                participants=[uuid4(), uuid4()], project_id=None,
            )
            state.left_content = Markdown(f"会议已启动: {result.id}")
            state.meeting_topic = topic
        except Exception as e:
            state.left_content = Text(f"启动会议失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw.startswith("/decide "):
        state.mode = "decision"
        title = raw[len("/decide "):]
        try:
            from cabinet.models.events import DecisionRequest
            from cabinet.models.decisions import DecisionType
            request = DecisionRequest(
                decision_id=uuid4(),
                decision_type=DecisionType.STRATEGIC.value,
                title=title,
                options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            result = await runtime.decision.submit(request)
            state.left_content = Markdown(f"**决策已提交:** {result.title}\n\n{result.description[:200]}")
        except Exception as e:
            state.left_content = Text(f"提交决策失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw.startswith("/task "):
        state.mode = "office"
        desc = raw[len("/task "):]
        try:
            from cabinet.models.events import TaskOrder
            order = TaskOrder(
                employee_id=uuid4(),
                skill_id=uuid4(),
                inputs={"description": desc},
            )
            result = await runtime.office.submit_task(order)
            state.left_content = Markdown(f"**任务已提交:** {result.id}\n状态: {result.status}")
        except Exception as e:
            state.left_content = Text(f"提交任务失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw.startswith("/strategy "):
        proposal = raw[len("/strategy "):]
        try:
            from cabinet.rooms.strategy.models import DecodeContext
            from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult
            from cabinet.rooms.meeting.models import ConvergenceResult
            session_id = uuid4()
            proposal_output = DeliberationOutput(
                session_id=session_id,
                proposal=DeliberationResult(
                    session_id=session_id,
                    proposal_text=proposal,
                    confidence=0.8,
                    reasoning_summary="direct input",
                    convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
                    rounds_used=1,
                    rumination_detected=False,
                ),
            )
            context = DecodeContext(
                project_id=uuid4(), captain_id=state.captain_id, existing_constraints=[]
            )
            blueprint = await runtime.strategy.decode(proposal_output, context)
            state.left_content = Markdown(
                f"**蓝图已解码:** {blueprint.id}\n领域: {', '.join(d.name for d in blueprint.domains)}"
            )
        except Exception as e:
            state.left_content = Text(f"解码战略失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw == "/review":
        state.mode = "summary"
        try:
            from cabinet.rooms.summary.models import ReviewType
            result = await runtime.summary.start_review(
                project_id=uuid4(), review_type=ReviewType.PROJECT_REVIEW
            )
            state.left_content = Markdown(f"复盘已启动: {result.id}")
        except Exception as e:
            state.left_content = Text(f"启动复盘失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw == "/skills":
        try:
            skills = await runtime.tool_registry.list_skills()
            table = Table(title="Available Skills")
            table.add_column("Name", style=f"bold {CABINET_BLUE}")
            table.add_column("Description")
            for s in skills:
                table.add_row(s.name, s.description[:60])
            state.left_content = table if skills else Text("暂无技能", style=STYLE_DIM)
        except Exception as e:
            state.left_content = Text(f"获取技能失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw == "/employees":
        try:
            if runtime.employee_store is None:
                state.left_content = Text("未配置员工存储", style=STYLE_DIM)
                return
            employees = await runtime.employee_store.list_all()
            table = Table(title="Registered Employees")
            table.add_column("Name", style=f"bold {CABINET_BLUE}")
            table.add_column("Role", style="green")
            table.add_column("Kind")
            for emp in employees:
                table.add_row(emp.name, emp.role, emp.kind)
            state.left_content = table if employees else Text("暂无员工", style=STYLE_DIM)
        except Exception as e:
            state.left_content = Text(f"获取员工失败: {e}", style=f"bold {CABINET_RED}")
        return

    cmd = raw.split()[0]
    mode = SLASH_COMMANDS.get(cmd)

    if mode and mode not in ("__quit__", "__status__", "__help__"):
        state.mode = mode
        state.left_content = None

    elif mode == "__status__":
        try:
            result = await runtime.secretary.summarize_pending(captain_id=state.captain_id)
            state.secretary_message = result.digest
            state.secretary_urgent = result.urgent_count > 0
        except Exception as e:
            state.secretary_message = f"获取状态失败: {e}"
            state.secretary_urgent = True

    elif mode == "__help__":
        state.left_content = _build_help_renderable()


async def _handle_chat(
    user_input: str,
    state: CockpitState,
    runtime,
    live: Live,
) -> None:
    from cabinet.rooms.secretary.models import InteractionContext

    try:
        context = InteractionContext(
            captain_id=state.captain_id,
            channel="terminal",
        )
        response = await runtime.secretary.process_input_stream(
            captain_input=user_input,
            context=context,
        )

        chunks: list[str] = []
        thinking_buffer: list[str] = []
        in_thinking = False
        thinking_tag_open = "<thinking>"
        thinking_tag_close = "</thinking>"

        last_flush = time.monotonic()

        async for chunk in response.stream:
            # Parse thinking tags
            remaining = chunk
            while remaining:
                if not in_thinking:
                    idx = remaining.find(thinking_tag_open)
                    if idx == -1:
                        chunks.append(remaining)
                        remaining = ""
                    else:
                        chunks.append(remaining[:idx])
                        remaining = remaining[idx + len(thinking_tag_open):]
                        in_thinking = True
                else:
                    idx = remaining.find(thinking_tag_close)
                    if idx == -1:
                        thinking_buffer.append(remaining)
                        remaining = ""
                    else:
                        thinking_buffer.append(remaining[:idx])
                        state.thinking_steps = _split_thinking_steps("".join(thinking_buffer))
                        thinking_buffer = []
                        remaining = remaining[idx + len(thinking_tag_close):]
                        in_thinking = False

            # Throttle: flush every 100ms or on sentence-ending punctuation
            now = time.monotonic()
            text = "".join(chunks)
            if now - last_flush > 0.1 or (text and text.rstrip() and text.rstrip()[-1] in (".", "。", "\n")):
                state.left_content = Markdown(text)
                live.update(_build_cockpit_layout(state))
                last_flush = now

        # Handle unclosed thinking tag
        if in_thinking and thinking_buffer:
            state.thinking_steps = _split_thinking_steps("".join(thinking_buffer))

        # Final flush — guaranteed complete content
        final_text = "".join(chunks)
        state.left_content = Markdown(final_text)
        live.update(_build_cockpit_layout(state))

        await response.finalize()
        if hasattr(response, "usage") and response.usage:
            state.token_count += response.usage.get("total_tokens", 0)
    except Exception as e:
        state.left_content = Text(f"对话错误: {e}", style=f"bold {CABINET_RED}")


def _split_thinking_steps(raw: str) -> list[str]:
    """Split raw thinking content into steps by newlines, filter empty lines."""
    return [line.strip() for line in raw.strip().split("\n") if line.strip()]


async def run_cockpit(console: Console, runtime, config, data_dir: str) -> None:
    state = CockpitState()
    history_path = _get_history_path(data_dir)
    session = PromptSession(
        history=FileHistory(str(history_path)),
        auto_suggest=AutoSuggestFromHistory(),
        completer=SLASH_COMPLETER,
    )

    try:
        greeting = await runtime.secretary.greet(captain_id=config.organization.captain_id)
        state.secretary_message = greeting.message
        state.captain_id = config.organization.captain_id
    except Exception:
        state.secretary_message = "秘书服务连接失败"
        state.secretary_urgent = True

    layout = _build_cockpit_layout(state)

    # Ctrl+T keybinding to toggle thinking panel preference
    kb = KeyBindings()

    @kb.add("c-t")
    def _(event):
        state.thinking_expanded = not state.thinking_expanded

    with Live(layout, console=console, screen=True, refresh_per_second=10) as live:
        while True:
            try:
                user_input = await session.prompt_async(
                    HTML(f"<b fg='#3B82F6'>{state.mode} &gt;</b> "),
                    style=INPUT_STYLE,
                    key_bindings=kb,
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
            state.secretary_urgent = False

            if stripped.startswith("/"):
                await _handle_slash_command(stripped, state, runtime)
            else:
                await _handle_chat(stripped, state, runtime, live)

            live.update(_build_cockpit_layout(state))
