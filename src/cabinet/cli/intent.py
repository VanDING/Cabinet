from __future__ import annotations

import re


def detect_intent(user_input: str) -> dict | None:
    """Detect user intent from natural language input.

    Returns intent dict with action type and params, or None for normal chat.
    """
    text = user_input.strip()

    meeting_patterns = [
        r"^开个?会?(讨论|聊聊|商量|研讨)一下(.+)",
        r"^开个?会?(讨论|聊聊|商量|研讨)(.+)",
        r"^(讨论|聊聊|商量|研讨)一下(.+)",
        r"^(讨论|聊聊|商量|研讨)(.+)",
        r"^开个?会\s*(.+)",
    ]
    for pattern in meeting_patterns:
        m = re.match(pattern, text)
        if m:
            topic = m.group(m.lastindex or 1).strip()
            return {"type": "meeting", "topic": topic,
                    "action_text": f"已为您在会议室创建审议「{topic}」"}

    task_patterns = [
        r"^(提醒我|别忘了|待办|帮我记一下)\s*(.+)",
    ]
    for pattern in task_patterns:
        m = re.match(pattern, text)
        if m:
            desc = m.group(2).strip()
            return {"type": "office", "description": desc,
                    "action_text": f"已为您添加待办「{desc}」"}

    decision_patterns = [
        r"^(决策|决定|是否应该|要不要|该不该)\s*(.+)",
    ]
    for pattern in decision_patterns:
        m = re.match(pattern, text)
        if m:
            title = m.group(2).strip()
            return {"type": "decision", "title": title,
                    "action_text": f"已为您提交决策请求「{title}」"}

    return None


async def execute_intent(intent: dict, state, runtime) -> str | None:
    """Execute detected intent against real room services. Returns feedback."""
    from uuid import uuid4
    from cabinet.rooms.meeting.models import MeetingLevel
    from cabinet.models.events import DecisionRequest, TaskOrder
    from cabinet.models.decisions import DecisionType

    try:
        if intent["type"] == "meeting":
            result = await runtime.meeting.start_session(
                topic=intent["topic"],
                level=MeetingLevel.MULTI_PARTY,
                participants=[uuid4()],
                project_id=None,
            )
            state.mode = "meeting"
            state.meeting_topic = intent["topic"]
            return intent["action_text"]

        elif intent["type"] == "office":
            order = TaskOrder(
                employee_id=uuid4(),
                skill_id=uuid4(),
                inputs={"description": intent["description"]},
            )
            await runtime.office.submit_task(order)
            state.mode = "office"
            state.office_workflow = intent["description"]
            return intent["action_text"]

        elif intent["type"] == "decision":
            request = DecisionRequest(
                decision_id=uuid4(),
                decision_type=DecisionType.STRATEGIC.value,
                title=intent["title"],
                options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            await runtime.decision.submit(request)
            state.mode = "decision"
            return intent["action_text"]
    except Exception as e:
        return f"操作执行失败: {e}"

    return None
