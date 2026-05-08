from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.agents.mailbox import MailboxRouter

logger = logging.getLogger(__name__)


class Position(BaseModel):
    agent_id: UUID
    stance: str
    argument: str
    round_number: int
    confidence: float = 0.5


class DebateConfig(BaseModel):
    pro_position: UUID
    con_position: UUID
    max_rounds: int = 3
    consensus_threshold: float = 0.7
    moderator_id: UUID | None = None


class DebateResult(BaseModel):
    topic: str = ""
    positions: list[Position] = []
    consensus_reached: bool = False
    final_verdict: str | None = None
    total_rounds: int = 0
    statements: list[dict] = []
    consensus: bool = False


class DebateProtocol:
    def __init__(self, agents: dict[UUID, object], mailbox_router: MailboxRouter):
        self._agents = agents
        self._router = mailbox_router

    async def run_debate(self, topic: str, config: DebateConfig) -> DebateResult:
        all_positions: list[Position] = []
        consensus_reached = False

        for round_num in range(1, config.max_rounds + 1):
            pro_agent = self._agents.get(config.pro_position)
            con_agent = self._agents.get(config.con_position)

            if pro_agent:
                prompt = f"Debate round {round_num} - PRO position on: {topic}"
                if all_positions:
                    prev = all_positions[-1]
                    prompt += f"\nResponding to: {prev.argument}"
                output = await pro_agent.execute(prompt, AgentContext())
                all_positions.append(Position(
                    agent_id=config.pro_position, stance="pro",
                    argument=output.content, round_number=round_num,
                ))

            if con_agent:
                prompt = f"Debate round {round_num} - CON position on: {topic}"
                if all_positions:
                    prev = all_positions[-1]
                    prompt += f"\nResponding to: {prev.argument}"
                output = await con_agent.execute(prompt, AgentContext())
                all_positions.append(Position(
                    agent_id=config.con_position, stance="con",
                    argument=output.content, round_number=round_num,
                ))

            if self._check_consensus(all_positions, config.consensus_threshold):
                consensus_reached = True
                break

        verdict = None
        if consensus_reached:
            verdict = "consensus"
        elif all_positions:
            pro_count = sum(1 for p in all_positions if p.stance == "pro")
            con_count = sum(1 for p in all_positions if p.stance == "con")
            verdict = "pro" if pro_count > con_count else "con" if con_count > pro_count else "tie"

        return DebateResult(
            topic=topic, positions=all_positions,
            consensus_reached=consensus_reached, final_verdict=verdict,
            total_rounds=all_positions[-1].round_number if all_positions else 0,
        )

    def _check_consensus(self, positions: list[Position], threshold: float) -> bool:
        if len(positions) < 2:
            return False
        compromise_kw = {"compromise", "agree", "accept", "consensus", "concede", "willing"}
        recent = positions[-2:]
        for pos in recent:
            lower = pos.argument.lower()
            if any(kw in lower for kw in compromise_kw):
                pos.confidence = max(pos.confidence, 0.7)
        avg_confidence = sum(p.confidence for p in recent) / len(recent)
        return avg_confidence >= threshold



@dataclass
class DebatePosition:
    agent: object  # BaseAgent
    stance: str    # "pro", "con", "neutral_critic", "synthesizer"


class NPartyDebate:
    """Multi-position debate: all positions open in parallel, then sequential rebuttal rounds."""

    def __init__(self, positions: list[DebatePosition], moderator_gateway,
                 max_rounds: int = 3):
        if len(positions) < 2:
            raise ValueError(f"Need at least 2 positions, got {len(positions)}")
        self._positions = positions
        self._gateway = moderator_gateway
        self._max_rounds = max_rounds

    async def run(self, topic: str) -> DebateResult:
        from cabinet.agents.parallel import ParallelExecutor, AgentTask

        # Phase 1: All positions open in parallel
        opening_tasks = [
            AgentTask(
                agent=p.agent,
                task=f"State your {p.stance} position on: {topic}",
                role_label=p.stance,
            )
            for p in self._positions
        ]
        executor = ParallelExecutor(self._gateway)
        openings = await executor.execute_parallel(opening_tasks)
        all_statements = list(openings.individual_results)

        # Phase 2: Sequential rebuttal rounds
        for round_num in range(self._max_rounds):
            for pos in self._positions:
                others = [
                    s for s in all_statements
                    if s.get("role") != pos.stance
                ]
                others_text = "\n".join(
                    f"[{s.get('role')}]: {s.get('content', '')[:300]}"
                    for s in others[-6:]
                )
                critique_task = (
                    f"Topic: {topic}\n"
                    f"Your stance: {pos.stance}\n"
                    f"Other positions:\n{others_text}\n\n"
                    f"Provide your rebuttal or refinement."
                )
                try:
                    output = await pos.agent.execute(critique_task, None)
                    all_statements.append({
                        "role": pos.stance,
                        "content": output.content if hasattr(output, 'content') else str(output),
                        "round": round_num + 1,
                    })
                except Exception as e:
                    all_statements.append({
                        "role": pos.stance,
                        "content": str(e),
                        "round": round_num + 1,
                    })

        # Phase 3: Moderator synthesis
        joined = "\n".join(
            f"[{s.get('role')}]: {s.get('content', '')[:300]}"
            for s in all_statements[-12:]
        )
        response = await self._gateway.complete(
            messages=[{
                "role": "system",
                "content": "You are a debate moderator. Summarize the debate, identify consensus and disagreements, and provide a final recommendation.",
            }, {
                "role": "user",
                "content": f"Topic: {topic}\n\nDebate:\n{joined}",
            }],
            model="default",
            temperature=0.3,
        )

        final_text = response.content if hasattr(response, 'content') else str(response)
        has_consensus = any(word in final_text.lower() for word in
                           ["consensus", "agreement", "agree", "共识", "一致"])

        return DebateResult(
            statements=all_statements,
            consensus=has_consensus,
            final_verdict=final_text,
        )
