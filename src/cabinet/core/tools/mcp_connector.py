from __future__ import annotations

from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from cabinet.models.primitives import SkillDefinition


class MCPConnector:
    def __init__(self):
        self._sessions: dict[str, ClientSession] = {}
        self._exit_stacks: dict[str, AsyncExitStack] = {}
        self._tool_to_server: dict[str, str] = {}

    async def connect_server(
        self,
        name: str,
        command: str,
        args: list[str] = [],
        env: dict[str, str] | None = None,
    ) -> None:
        if name in self._sessions:
            raise ValueError(f"Server '{name}' already connected")

        stack = AsyncExitStack()
        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=env,
        )
        read_stream, write_stream = await stack.enter_async_context(stdio_client(server_params))
        session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
        await session.initialize()

        self._sessions[name] = session
        self._exit_stacks[name] = stack

        result = await session.list_tools()
        for tool in result.tools:
            self._tool_to_server[tool.name] = name

    async def disconnect_server(self, name: str) -> None:
        stack = self._exit_stacks.pop(name, None)
        if stack is not None:
            await stack.aclose()
        self._sessions.pop(name, None)
        self._tool_to_server = {k: v for k, v in self._tool_to_server.items() if v != name}

    async def disconnect_all(self) -> None:
        for name in list(self._sessions.keys()):
            await self.disconnect_server(name)

    async def discover_tools(self, server_name: str) -> list[SkillDefinition]:
        session = self._sessions.get(server_name)
        if session is None:
            raise ValueError(f"Server '{server_name}' not connected")

        result = await session.list_tools()
        return [
            SkillDefinition(
                name=tool.name,
                description=tool.description or "",
                kind="atomic",
                input_schema=tool.inputSchema
                if hasattr(tool, "inputSchema") and tool.inputSchema
                else {"type": "object"},
                output_schema={"type": "object"},
            )
            for tool in result.tools
        ]

    async def call_tool(self, tool_name: str, arguments: dict) -> dict[str, Any]:
        server_name = self._tool_to_server.get(tool_name)
        if server_name is None:
            raise ValueError(f"Unknown tool: {tool_name}")

        session = self._sessions.get(server_name)
        if session is None:
            raise ValueError(f"Server '{server_name}' not connected")

        result = await session.call_tool(tool_name, arguments)
        content_parts = []
        for item in result.content:
            if hasattr(item, "text"):
                content_parts.append(item.text)
        return {"content": " ".join(content_parts) if content_parts else str(result.content)}

    async def list_connected_servers(self) -> list[str]:
        return list(self._sessions.keys())
