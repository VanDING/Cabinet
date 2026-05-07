from __future__ import annotations

import re

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.reactive import reactive
from textual.screen import Screen
from textual.widgets import Input, Static

from cabinet.cli.intent import detect_intent, execute_intent
from cabinet.cli.widgets.conversation import ConversationView
from cabinet.cli.widgets.header import Header
from cabinet.cli.widgets.input_area import InputArea
from cabinet.cli.widgets.side_panels import DecisionPanel, MeetingPanel, OfficePanel
from cabinet.cli.widgets.thinking import ThinkingPanel


def _split_thinking_steps(raw: str) -> list[str]:
    """Split raw thinking content into steps by newlines, filter empty lines."""
    return [line.strip() for line in raw.strip().split("\n") if line.strip()]


_THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL)


class CockpitScreen(Screen):
    """Main cockpit TUI screen."""

    BINDINGS = [
        ("ctrl+t", "toggle_thinking", "Toggle Thinking"),
        ("ctrl+c", "request_quit", "Quit"),
    ]

    # ── Reactive state (replaces CockpitState dataclass) ──
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

    def __init__(self, runtime, config, data_dir: str):
        super().__init__()
        self.runtime = runtime
        self.config = config
        self.data_dir = data_dir

    def compose(self) -> ComposeResult:
        yield Header(id="header")
        yield Static("📋 秘书：Captain，一切正常", id="secretary-bar")
        with Horizontal(id="main-area"):
            with Vertical(id="left-content"):
                yield ThinkingPanel(id="thinking-panel")
                yield ConversationView(id="conversation-view")
            with Vertical(id="right-panel"):
                yield MeetingPanel(id="meeting-panel")
                yield DecisionPanel(id="decision-panel")
                yield OfficePanel(id="office-panel")
        yield InputArea(data_dir=self.data_dir, id="input-area")

    def on_mount(self) -> None:
        self.set_interval(1, self._tick)
        self._greet()

    def _tick(self) -> None:
        self.elapsed_seconds += 1

    def _format_elapsed(self) -> str:
        h, rem = divmod(self.elapsed_seconds, 3600)
        m, s = divmod(rem, 60)
        return f"{h}:{m:02d}:{s:02d}"

    # ── watch methods (auto-triggered on reactive change) ──

    def watch_mode(self, old: str, new: str) -> None:
        header = self.query_one("#header", Header)
        header.update_info(self.token_count, self._format_elapsed(), new)
        input_area = self.query_one("#input-area")
        if input_area is not None:
            input_area.set_placeholder(new)
        self.run_worker(self._refresh_room_state())

    def watch_token_count(self, old: int, new: int) -> None:
        self.query_one("#header", Header).update_info(
            new, self._format_elapsed(), self.mode
        )

    def watch_elapsed_seconds(self, old: int, new: int) -> None:
        self.query_one("#header", Header).update_info(
            self.token_count, self._format_elapsed(), self.mode
        )

    def watch_secretary_message(self, old: str, new: str) -> None:
        bar = self.query_one("#secretary-bar", Static)
        bar.update(f"\U0001f4cb 秘书：{new}" if new else "\U0001f4cb 秘书：Captain，一切正常")

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

    def watch_meeting_topic(self, old, new) -> None:
        self._sync_panels()

    def watch_decision_red(self, old, new) -> None:
        self._sync_panels()

    def watch_office_workflow(self, old, new) -> None:
        self._sync_panels()

    async def _greet(self) -> None:
        try:
            greeting = await self.runtime.secretary.greet(
                captain_id=self.config.organization.captain_id
            )
            self.captain_id = self.config.organization.captain_id
            self.secretary_message = greeting.message  # watch_secretary_message auto-updates UI
        except Exception:
            self.secretary_message = "秘书服务连接失败"

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle user input: intent detection or chat."""
        value = event.value.strip() if event.value else ""
        if not value:
            return
        if value == "/quit":
            self.app.exit()
            return

        # Add to conversation (UI + state) and clear input
        self.query_one("#conversation-view", ConversationView).add_user_message(value)
        self.conversation.append({"role": "user", "content": value})
        event.input.clear()

        if value.startswith("/"):
            self._handle_slash_command(value)
        else:
            intent = detect_intent(value)
            if intent:
                self.run_worker(self._execute_and_respond(intent, value))
            else:
                self.run_worker(self._stream_chat(value), exclusive=True)

    async def _execute_and_respond(self, intent: dict, user_input: str) -> None:
        feedback = await execute_intent(intent, self, self.runtime)
        if feedback:
            self.secretary_message = feedback  # watch auto-updates
            self.query_one("#conversation-view", ConversationView).add_assistant_message(
                f"📋 {feedback}"
            )
            await self._refresh_room_state()

    async def _stream_chat(self, user_input: str) -> None:
        from cabinet.rooms.secretary.models import InteractionContext

        conversation = self.query_one("#conversation-view", ConversationView)
        recent = self.conversation[-20:]
        recent_interactions = [
            f"[{m['role']}]: {m['content'][:200]}" for m in recent
        ]

        context = InteractionContext(
            captain_id=self.captain_id,
            channel="terminal",
            recent_interactions=recent_interactions,
        )

        try:
            response = await self.runtime.secretary.process_input_stream(
                captain_input=user_input,
                context=context,
            )
            chunks: list[str] = []
            async for chunk in response.stream:
                chunks.append(chunk)

            final_text = "".join(chunks)

            # Extract thinking chain from response
            m = _THINKING_RE.search(final_text)
            if m:
                steps = _split_thinking_steps(m.group(1))
                self.thinking_steps = steps  # watch_thinking_steps auto-updates panel
                final_text = _THINKING_RE.sub("", final_text).strip()

            self.conversation.append({"role": "assistant", "content": final_text})
            conversation.add_assistant_message(final_text)

            await response.finalize()
            if hasattr(response, "usage") and response.usage:
                self.token_count += response.usage.get("total_tokens", 0)

        except Exception as e:
            self.conversation.append({
                "role": "assistant", "content": f"对话错误: {e}"
            })
            conversation.add_assistant_message(f"对话错误: {e}")

    def _handle_slash_command(self, text: str) -> None:
        """Handle slash commands (mode switches, actions, info)."""
        parts = text.split(maxsplit=1)
        cmd = parts[0]
        arg = parts[1] if len(parts) > 1 else ""

        mode_names = {
            "decision": "决策室", "meeting": "会议室",
            "office": "办公室", "summary": "总结室",
        }

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
            self.run_worker(self._show_skills())
        elif cmd == "/employees":
            self.run_worker(self._show_employees())
        elif cmd == "/status":
            self.run_worker(self._handle_status())
        elif cmd == "/help":
            self._show_help()
        elif cmd == "/quit":
            self.app.exit()
        else:
            self.secretary_message = f"未知命令: {cmd}，输入 /help 查看帮助"

    async def _execute_slash_intent(self, intent_type: str, arg: str) -> None:
        """Execute intent from slash command with argument."""
        from cabinet.cli.intent import execute_intent

        intent_map = {
            "decision": {"type": "decision", "title": arg,
                         "action_text": f"已提交决策「{arg}」"},
            "office": {"type": "office", "description": arg,
                       "action_text": f"已添加待办「{arg}」"},
        }
        intent = intent_map[intent_type]
        feedback = await execute_intent(intent, self, self.runtime)
        if feedback:
            self.secretary_message = feedback
            self.query_one("#conversation-view", ConversationView).add_assistant_message(
                f"\U0001f4cb {feedback}"
            )
            await self._refresh_room_state()

    async def _show_skills(self) -> None:
        """List registered skills in conversation view."""
        conversation = self.query_one("#conversation-view", ConversationView)
        try:
            skills = getattr(self.runtime.tool_registry, "_skills", {})
            if skills:
                lines = ["**已注册技能:**"]
                for s in list(skills.values())[:20]:
                    lines.append(f"- **{s.name}**: {s.description or '无描述'}")
                conversation.add_assistant_message("\n".join(lines))
            else:
                conversation.add_assistant_message("暂无注册技能")
        except Exception as e:
            conversation.add_assistant_message(f"获取技能列表失败: {e}")

    async def _show_employees(self) -> None:
        """List registered employees in conversation view."""
        conversation = self.query_one("#conversation-view", ConversationView)
        try:
            employees = getattr(self.runtime, "employee_store", None)
            if employees and hasattr(employees, "list_all"):
                emp_list = employees.list_all()
                if emp_list:
                    lines = ["**注册员工:**"]
                    for e in emp_list:
                        lines.append(f"- **{e.name}** ({e.role}): {e.personality or ''}")
                    conversation.add_assistant_message("\n".join(lines))
                else:
                    conversation.add_assistant_message("暂无注册员工")
            else:
                conversation.add_assistant_message("暂无注册员工")
        except Exception as e:
            conversation.add_assistant_message(f"获取员工列表失败: {e}")

    def _sync_panels(self) -> None:
        self.query_one("#meeting-panel", MeetingPanel).update_state(
            topic=self.meeting_topic,
            advisors=self.meeting_advisors,
            round_num=self.meeting_round,
        )
        self.query_one("#decision-panel", DecisionPanel).update_state(
            red=self.decision_red,
            yellow=self.decision_yellow,
            blue=self.decision_blue,
        )
        self.query_one("#office-panel", OfficePanel).update_state(
            workflow=self.office_workflow,
            progress=self.office_progress,
            current_node=self.office_current_node,
        )

    async def _refresh_room_state(self) -> None:
        """Pull live data from room services into panel reactive attributes."""
        project_id = self.config.default_project

        # Decision room: count cards by type
        try:
            dashboard = await self.runtime.decision.get_dashboard(project_id)
            self.decision_red = len(dashboard.red_cards)
            self.decision_yellow = len(dashboard.yellow_cards)
            self.decision_blue = len(dashboard.blue_cards)
        except Exception:
            pass  # Keep defaults if service unavailable

        # Office: show first active task
        try:
            tasks = await self.runtime.office.list_active_tasks(project_id)
            if tasks:
                task = tasks[0]
                self.office_workflow = getattr(task, "description", str(task.id))
                self.office_current_node = getattr(task, "status", "")
            else:
                self.office_workflow = ""
                self.office_current_node = ""
        except Exception:
            pass

        self._sync_panels()

    async def _handle_status(self) -> None:
        try:
            result = await self.runtime.secretary.summarize_pending(
                captain_id=self.captain_id
            )
            self.secretary_message = result.digest
            self.secretary_urgent = result.urgent_count > 0
            await self._refresh_room_state()
        except Exception as e:
            self.secretary_message = f"获取状态失败: {e}"

    def _show_help(self) -> None:
        conversation = self.query_one("#conversation-view", ConversationView)
        help_text = """**可用命令:**
- /decision — 切换决策室
- /meeting — 切换会议室
- /office — 切换办公室
- /summary — 切换总结室
- /decide <title> — 提交决策
- /task <desc> — 提交任务
- /strategy <proposal> — 解码战略
- /review — 启动复盘
- /skills — 列出技能
- /employees — 列出员工
- /status — 待处理摘要
- /help — 显示帮助
- /quit — 退出"""
        conversation.add_assistant_message(help_text)

    def action_toggle_thinking(self) -> None:
        self.thinking_expanded = not self.thinking_expanded

    def action_request_quit(self) -> None:
        self.app.exit()
