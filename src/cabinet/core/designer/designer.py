from __future__ import annotations

from uuid import UUID

from cabinet.core.designer.generator import WorkflowGenerator
from cabinet.core.designer.protocol import (
    DesignPreview,
    DesignRequest,
    DesignSession,
    PipeSummary,
)
from cabinet.core.designer.template_store import TemplateStore
from cabinet.core.pipes.registry import PipeRegistry


class DefaultDesigner:
    """Orchestrates the full design lifecycle.

    Steps: search templates -> generate workflow+pipes -> present preview
    -> refine with feedback -> confirm / reject.
    """

    def __init__(
        self,
        gateway,
        template_store: TemplateStore,
        pipe_registry: PipeRegistry,
    ):
        self._gateway = gateway
        self._template_store = template_store
        self._pipe_registry = pipe_registry
        self._generator = WorkflowGenerator(gateway)
        self._sessions: dict[UUID, DesignSession] = {}

    async def start_design(self, request: DesignRequest) -> DesignSession:
        templates = await self._template_store.search(request.description)
        session = DesignSession(
            captain_id="captain",
            description=request.description,
            matched_templates=[t.id for t in templates],
        )
        workflow, pipes = await self._generator.generate(request.description, templates)
        session.draft_workflow = workflow
        session.draft_pipes = pipes
        self._sessions[session.id] = session
        return session

    async def refine_design(self, session_id: UUID, feedback: str) -> DesignSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(f"Session not found: {session_id}")
        session.conversation_history.append({"role": "captain", "content": feedback})
        updated_desc = f"{session.description}\n\n用户反馈：{feedback}"
        workflow, pipes = await self._generator.generate(updated_desc)
        session.draft_workflow = workflow
        session.draft_pipes = pipes
        session.status = "awaiting_confirm"
        return session

    async def get_preview(self, session_id: UUID) -> DesignPreview:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(f"Session not found: {session_id}")
        wf = session.draft_workflow or {}
        nodes = wf.get("nodes", [])
        skill_nodes = [n for n in nodes if n.get("kind") == "skill"]
        summary_text = f"{len(nodes)} 个节点，{len(skill_nodes)} 个处理步骤"
        pipe_summaries = [
            PipeSummary(
                name=p.get("name", "unnamed"),
                description=p.get("description", ""),
                kind=p.get("kind", "atomic"),
                assigned_to_node="",
            )
            for p in session.draft_pipes
        ]
        return DesignPreview(
            session_id=session_id,
            workflow_summary=summary_text,
            node_count=len(nodes),
            pipes=pipe_summaries,
            suggestions=[],
        )

    async def confirm_design(self, session_id: UUID) -> DesignSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(f"Session not found: {session_id}")
        session.status = "confirmed"
        return session

    async def reject_design(self, session_id: UUID) -> DesignSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(f"Session not found: {session_id}")
        session.status = "rejected"
        return session
