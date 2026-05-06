from __future__ import annotations

import asyncio

import typer
from rich.console import Console
from rich.panel import Panel

console = Console()

agent_app = typer.Typer(name="agent", help="Agent orchestration management")


def register(app):
    @agent_app.command("pool-status")
    def agent_pool_status(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_agent_pool_status_async(data_dir))

    @agent_app.command("discover")
    def agent_discover(
        role: str = typer.Option(None, "--role", help="Filter by role"),
        skill: str = typer.Option(None, "--skill", help="Filter by skill"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_agent_discover_async(role, skill, data_dir))

    @agent_app.command("compose-team")
    def agent_compose_team(
        task: str = typer.Argument(..., help="Task description"),
        roles: str = typer.Option("", "--roles", help="Comma-separated required roles"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_agent_compose_team_async(task, roles, data_dir))

    app.add_typer(agent_app, name="agent")


async def _agent_pool_status_async(data_dir: str) -> None:
    from cabinet.cli.main import _init_agent_runtime

    runtime = await _init_agent_runtime(data_dir)
    if runtime is None:
        return
    health = await runtime.agent_pool.health_check()
    console.print(Panel("Agent Pool Status", style="bold blue"))
    console.print(f"Total agents: {health['total']}")
    for state, count in health.get("by_state", {}).items():
        console.print(f"  {state}: {count}")
    for role, count in health.get("by_role", {}).items():
        console.print(f"  role={role}: {count}")


async def _agent_discover_async(role: str | None, skill: str | None, data_dir: str) -> None:
    from cabinet.cli.main import _init_agent_runtime

    runtime = await _init_agent_runtime(data_dir)
    if runtime is None:
        return
    results = await runtime.capability_registry.discover(role=role, skill=skill)
    if not results:
        console.print("[yellow]No agents found matching criteria.[/yellow]")
        return
    console.print(Panel(f"Discovered Agents ({len(results)})", style="bold green"))
    for cap in results:
        console.print(f"  Agent: {cap.agent_id} | Role: {cap.role} | Skills: {', '.join(cap.skills) or 'none'} | Load: {cap.current_load}/{cap.max_concurrent_tasks}")


async def _agent_compose_team_async(task: str, roles: str, data_dir: str) -> None:
    from cabinet.cli.main import _init_agent_runtime

    runtime = await _init_agent_runtime(data_dir)
    if runtime is None:
        return
    required_roles = [r.strip() for r in roles.split(",") if r.strip()] if roles else None
    composition = await runtime.capability_registry.discover(role=required_roles[0] if required_roles else None)
    if not composition:
        console.print("[yellow]No agents available for team composition.[/yellow]")
        return
    from cabinet.agents.composer import TeamComposer
    composer = TeamComposer(runtime.capability_registry)
    result = await composer.compose(task, required_roles=required_roles)
    console.print(Panel(f"Team Composition: {result.id}", style="bold green"))
    console.print(f"Task: {result.task}")
    console.print(f"Strategy: {result.strategy}")
    console.print(f"Leader: {result.leader_id}")
    for m in result.members:
        console.print(f"  Member: {m.agent_id} | Role: {m.role} | Skills: {', '.join(m.skills) or 'none'}")
