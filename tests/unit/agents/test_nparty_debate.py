from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from cabinet.agents.debate import NPartyDebate, DebatePosition


def make_mock_agent(stance: str, response: str):
    agent = MagicMock()
    agent.execute = AsyncMock(return_value=MagicMock(content=response, status="success"))
    return agent


def test_nparty_debate_runs_all_positions():
    agents = [
        make_mock_agent("pro", "We should adopt this change"),
        make_mock_agent("con", "This is too risky"),
        make_mock_agent("neutral", "Consider the middle ground"),
    ]
    positions = [
        DebatePosition(agent=agents[0], stance="pro"),
        DebatePosition(agent=agents[1], stance="con"),
        DebatePosition(agent=agents[2], stance="neutral_critic"),
    ]

    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Debate concluded: adopt with caution"))

    debate = NPartyDebate(positions, mock_gateway, max_rounds=1)

    async def run():
        result = await debate.run("Should we migrate the database?")
        assert result.consensus is not None
        assert len(result.statements) > 0

    asyncio.run(run())


def test_debate_position_fields():
    agent = make_mock_agent("pro", "")
    pos = DebatePosition(agent=agent, stance="pro")
    assert pos.stance == "pro"


def test_nparty_needs_at_least_2():
    mock_gateway = MagicMock()
    pos = [DebatePosition(agent=make_mock_agent("pro", ""), stance="pro")]
    try:
        NPartyDebate(pos, mock_gateway)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_nparty_with_2_positions():
    agents = [
        make_mock_agent("pro", "Option A is best"),
        make_mock_agent("con", "Option A has risks"),
    ]
    positions = [
        DebatePosition(agent=agents[0], stance="pro"),
        DebatePosition(agent=agents[1], stance="con"),
    ]

    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Consensus: proceed with caution"))

    debate = NPartyDebate(positions, mock_gateway, max_rounds=1)

    async def run():
        result = await debate.run("Choose between A and B")
        assert len(result.statements) > 0

    asyncio.run(run())
