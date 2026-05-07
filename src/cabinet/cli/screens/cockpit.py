from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Input, Static

from cabinet.cli.intent import detect_intent, execute_intent
from cabinet.cli.state import CockpitState
from cabinet.cli.widgets.conversation import ConversationView
from cabinet.cli.widgets.header import Header
from cabinet.cli.widgets.side_panels import DecisionPanel, MeetingPanel, OfficePanel
from cabinet.cli.widgets.thinking import ThinkingPanel


class CockpitScreen(Screen):
    """Main cockpit TUI screen."""

    BINDINGS = [
        ("ctrl+t", "toggle_thinking", "Toggle Thinking"),
        ("ctrl+c", "request_quit", "Quit"),
    ]

    def __init__(self, runtime, config, data_dir: str):
        super().__init__()
        self.runtime = runtime
        self.config = config
        self.data_dir = data_dir
        self.state = CockpitState()

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
        yield Input(placeholder="decision > ", id="prompt-input")

    def on_mount(self) -> None:
        self._greet()

    async def _greet(self) -> None:
        try:
            greeting = await self.runtime.secretary.greet(
                captain_id=self.config.organization.captain_id
            )
            self.state.secretary_message = greeting.message
            self.state.captain_id = self.config.organization.captain_id
            self.query_one("#secretary-bar").update(
                f"📋 秘书：{greeting.message}"
            )
        except Exception:
            self.query_one("#secretary-bar").update(
                "📋 秘书：秘书服务连接失败"
            )

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle user input: intent detection or chat."""
        value = event.value.strip() if event.value else ""
        if not value:
            return
        if value == "/quit":
            self.app.exit()
            return

        # Add to conversation and clear input
        self.query_one("#conversation-view", ConversationView).add_user_message(value)
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
        feedback = await execute_intent(intent, self.state, self.runtime)
        if feedback:
            self.state.secretary_message = feedback
            self.query_one("#secretary-bar").update(f"📋 秘书：{feedback}")
            self.query_one("#conversation-view", ConversationView).add_assistant_message(
                f"📋 {feedback}"
            )

    async def _stream_chat(self, user_input: str) -> None:
        from cabinet.rooms.secretary.models import InteractionContext

        conversation = self.query_one("#conversation-view", ConversationView)
        recent = self.state.conversation[-10:]
        recent_interactions = [
            f"[{m['role']}]: {m['content'][:200]}" for m in recent[:-1]
        ]

        context = InteractionContext(
            captain_id=self.state.captain_id,
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
            self.state.conversation.append({"role": "assistant", "content": final_text})
            conversation.add_assistant_message(final_text)

            await response.finalize()
            if hasattr(response, "usage") and response.usage:
                self.state.token_count += response.usage.get("total_tokens", 0)

        except Exception as e:
            self.state.conversation.append({
                "role": "assistant", "content": f"对话错误: {e}"
            })
            conversation.add_assistant_message(f"对话错误: {e}")

    def _handle_slash_command(self, text: str) -> None:
        """Handle slash commands (mode switches, status, help)."""
        cmd = text.split()[0]
        if cmd in ("/decision", "/meeting", "/office", "/summary"):
            self.state.mode = cmd.lstrip("/")
            mode_names = {
                "decision": "决策室", "meeting": "会议室",
                "office": "办公室", "summary": "总结室",
            }
            name = mode_names.get(self.state.mode, self.state.mode)
            self.query_one("#header", Header).update_info(
                self.state.token_count, "0:00", self.state.mode
            )
            self.query_one("#secretary-bar").update(f"📋 秘书：已切换至{name}")
        elif cmd == "/status":
            self.run_worker(self._handle_status())
        elif cmd == "/help":
            self._show_help()
        else:
            self.query_one("#secretary-bar").update(
                f"📋 秘书：未知命令: {cmd}，输入 /help 查看帮助"
            )

    def _sync_panels(self) -> None:
        self.query_one("#meeting-panel", MeetingPanel).update_state(self.state)
        self.query_one("#decision-panel", DecisionPanel).update_state(self.state)
        self.query_one("#office-panel", OfficePanel).update_state(self.state)

    async def _handle_status(self) -> None:
        try:
            result = await self.runtime.secretary.summarize_pending(
                captain_id=self.state.captain_id
            )
            self.state.secretary_message = result.digest
            self.state.secretary_urgent = result.urgent_count > 0
            self.query_one("#secretary-bar").update(
                f"📋 秘书：{result.digest}"
            )
        except Exception as e:
            self.query_one("#secretary-bar").update(f"📋 秘书：获取状态失败: {e}")

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
        self.state.thinking_expanded = not self.state.thinking_expanded

    def action_request_quit(self) -> None:
        self.app.exit()
