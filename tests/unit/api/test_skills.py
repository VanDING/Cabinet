from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4

from cabinet.models.primitives import SkillDefinition


@pytest.mark.asyncio
async def test_list_skills_empty(app, mock_runtime):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/skills")
        assert response.status_code == 200
        assert response.json() == []


@pytest.mark.asyncio
async def test_run_skill_success(app, mock_runtime):
    from cabinet.core.tools.protocol import SkillOutput

    mock_runtime.tool_registry.execute = AsyncMock(
        return_value=SkillOutput(content="skill result", skill_id=uuid4())
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/skills/test-skill/run",
            json={"inputs": {"key": "value"}},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["skill_name"] == "test-skill"
        assert data["output"] == "skill result"


@pytest.mark.asyncio
async def test_run_skill_not_found(app, mock_runtime):
    mock_runtime.tool_registry.execute = AsyncMock(side_effect=ValueError("Skill not found"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/skills/nonexistent/run",
            json={"inputs": {}},
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_load_skill(app, mock_runtime):
    mock_skill = SkillDefinition(
        id=uuid4(),
        name="test-skill",
        kind="prompt",
        description="A test skill",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        requires_knowledge=[],
    )

    with patch("cabinet.core.tools.skill_store.SkillStore") as MockStore:
        mock_store_instance = AsyncMock()
        mock_store_instance.load_skill = AsyncMock(return_value=mock_skill)
        MockStore.return_value = mock_store_instance

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/skills/load",
                params={"path": "/tmp/test-skill.md"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "test-skill"
            assert data["description"] == "A test skill"
