from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.agents.mailbox import MailboxRouter

logger = logging.getLogger(__name__)

DialogueMode = Literal["round_robin", "moderator", "free_form"]


class DialogueTurn(BaseModel):
    agent_id: UUID
    content: str
    turn_number: int
    metadata: dict = {}


class DialogueConfig(BaseModel):
    participants: list[UUID]
    mode: DialogueMode = "round_robin"
    max_rounds: int = 5
    convergence_check: str | None = None
    moderator_id: UUID | None = None


class DialogueResult(BaseModel):
    topic: str
    turns: list[DialogueTurn]
    total_rounds: int
    converged: bool
    summary: str | None = None


class DialogueOrchestrator:
    def __init__(self, agents: dict[UUID, object], mailbox_router: MailboxRouter):
        self._agents = agents
        self._router = mailbox_router

    async def start_dialogue(
        self, config: DialogueConfig, topic: str, context: dict
    ) -> DialogueResult:
        all_turns: list[DialogueTurn] = []
        turn_counter = 0
        converged = False
        round_num = 0

        for round_num in range(1, config.max_rounds + 1):
            round_turns = await self._run_round(config, topic, context, round_num, turn_counter)
            all_turns.extend(round_turns)
            turn_counter += len(round_turns)

            if config.convergence_check and self._check_convergence(all_turns, config.convergence_check):
                converged = True
                break

        return DialogueResult(
            topic=topic, turns=all_turns,
            total_rounds=round_num if all_turns else 0,
            converged=converged,
        )

    async def _run_round(
        self, config: DialogueConfig, topic: str, context: dict,
        round_num: int, turn_offset: int,
    ) -> list[DialogueTurn]:
        turns = []
        if config.mode == "round_robin":
            for i, pid in enumerate(config.participants):
                agent = self._agents.get(pid)
                if agent is None:
                    continue
                prompt = f"Round {round_num}, speaker {i+1}/{len(config.participants)}. Topic: {topic}"
                if context:
                    prompt += f"\nContext: {context}"
                output = await agent.execute(prompt, AgentContext())
                turns.append(DialogueTurn(
                    agent_id=pid, content=output.content,
                    turn_number=turn_offset + i + 1,
                ))
        elif config.mode == "moderator" and config.moderator_id:
            moderator = self._agents.get(config.moderator_id)
            if moderator:
                prompt = f"As moderator, decide who should speak in round {round_num} on topic: {topic}"
                mod_output = await moderator.execute(prompt, AgentContext())
                for pid in config.participants:
                    if pid != config.moderator_id:
                        agent = self._agents.get(pid)
                        if agent:
                            p_output = await agent.execute(
                                f"Respond to discussion on: {topic}. Context: {mod_output.content}",
                                AgentContext(),
                            )
                            turns.append(DialogueTurn(
                                agent_id=pid, content=p_output.content,
                                turn_number=turn_offset + len(turns) + 1,
                            ))
        return turns

    def _check_convergence(self, turns: list[DialogueTurn], check_type: str) -> bool:
        if check_type == "consensus":
            if len(turns) < 2:
                return False
            disagree_kw = {"disagree", "oppose", "reject", "against", "object"}
            agree_kw = {"agree", "support", "consensus", "accept", "approve"}
            for turn in turns:
                lower = turn.content.lower()
                has_disagree = any(kw in lower for kw in disagree_kw)
                has_agree = any(kw in lower for kw in agree_kw)
                if has_disagree and not has_agree:
                    return False
            return True
        return False
