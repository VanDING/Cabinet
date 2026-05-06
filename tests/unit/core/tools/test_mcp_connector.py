from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cabinet.core.tools.mcp_connector import MCPConnector
from cabinet.models.primitives import SkillDefinition


@pytest.fixture
def connector():
    return MCPConnector()


@pytest.mark.asyncio
async def test_connect_server_establishes_session(connector):
    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()
    mock_tool = MagicMock()
    mock_tool.name = "test_tool"
    mock_tool.description = "A test tool"
    mock_tool.inputSchema = {"type": "object"}
    mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[mock_tool]))

    mock_read = AsyncMock()
    mock_write = AsyncMock()

    with patch("cabinet.core.tools.mcp_connector.stdio_client"), \
         patch("cabinet.core.tools.mcp_connector.ClientSession", return_value=mock_session), \
         patch("cabinet.core.tools.mcp_connector.AsyncExitStack") as mock_stack_cls:
        mock_stack = AsyncMock()
        mock_stack.enter_async_context = AsyncMock(side_effect=[(mock_read, mock_write), mock_session])
        mock_stack.__aenter__ = AsyncMock(return_value=mock_stack)
        mock_stack.__aexit__ = AsyncMock(return_value=False)
        mock_stack_cls.return_value = mock_stack

        await connector.connect_server("test-server", "python", ["-m", "mcp_server"])

    assert "test-server" in await connector.list_connected_servers()


@pytest.mark.asyncio
async def test_disconnect_server_removes_session(connector):
    connector._sessions["test-server"] = AsyncMock()
    connector._exit_stacks["test-server"] = AsyncMock()
    connector._exit_stacks["test-server"].aclose = AsyncMock()
    connector._tool_to_server["tool_a"] = "test-server"

    await connector.disconnect_server("test-server")

    assert "test-server" not in connector._sessions
    assert "test-server" not in connector._exit_stacks
    assert "tool_a" not in connector._tool_to_server


@pytest.mark.asyncio
async def test_disconnect_all_removes_all_sessions(connector):
    connector._sessions["s1"] = AsyncMock()
    connector._sessions["s2"] = AsyncMock()
    connector._exit_stacks["s1"] = AsyncMock()
    connector._exit_stacks["s1"].aclose = AsyncMock()
    connector._exit_stacks["s2"] = AsyncMock()
    connector._exit_stacks["s2"].aclose = AsyncMock()

    await connector.disconnect_all()

    assert len(connector._sessions) == 0
    assert len(connector._exit_stacks) == 0


@pytest.mark.asyncio
async def test_discover_tools_maps_to_skill_definitions(connector):
    mock_tool = MagicMock()
    mock_tool.name = "send_email"
    mock_tool.description = "Send an email"
    mock_tool.inputSchema = {"type": "object", "properties": {"to": {"type": "string"}}}

    mock_session = AsyncMock()
    mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[mock_tool]))
    connector._sessions["email-server"] = mock_session
    connector._tool_to_server["send_email"] = "email-server"

    skills = await connector.discover_tools("email-server")
    assert len(skills) == 1
    assert isinstance(skills[0], SkillDefinition)
    assert skills[0].name == "send_email"
    assert skills[0].kind == "atomic"
    assert skills[0].input_schema == {"type": "object", "properties": {"to": {"type": "string"}}}


@pytest.mark.asyncio
async def test_call_tool_routes_to_correct_server(connector):
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.content = [MagicMock(text="Email sent")]
    mock_session.call_tool = AsyncMock(return_value=mock_result)
    connector._sessions["email-server"] = mock_session
    connector._tool_to_server["send_email"] = "email-server"

    result = await connector.call_tool("send_email", {"to": "test@example.com"})
    assert result["content"] == "Email sent"
    mock_session.call_tool.assert_called_once_with("send_email", {"to": "test@example.com"})


@pytest.mark.asyncio
async def test_call_tool_unknown_tool_raises(connector):
    with pytest.raises(ValueError, match="Unknown tool"):
        await connector.call_tool("unknown_tool", {})


@pytest.mark.asyncio
async def test_list_connected_servers(connector):
    connector._sessions["s1"] = AsyncMock()
    connector._sessions["s2"] = AsyncMock()

    servers = await connector.list_connected_servers()
    assert sorted(servers) == ["s1", "s2"]


@pytest.mark.asyncio
async def test_connect_server_already_connected_raises(connector):
    connector._sessions["existing"] = AsyncMock()
    with pytest.raises(ValueError, match="already connected"):
        await connector.connect_server("existing", "python", [])
