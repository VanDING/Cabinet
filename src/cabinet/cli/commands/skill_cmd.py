from __future__ import annotations

import asyncio
import os

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()

skill_app = typer.Typer(name="skill", help="Manage skills")


def register(app):
    @skill_app.command("load")
    def skill_load(
        path: str = typer.Argument(..., help="Path to skill markdown file"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        config_path = os.path.join(data_dir, "cabinet.json")
        if not os.path.exists(config_path):
            console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
            raise typer.Exit(code=1)
        asyncio.run(_skill_load_async(path, data_dir))

    @skill_app.command("list")
    def skill_list(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        config_path = os.path.join(data_dir, "cabinet.json")
        if not os.path.exists(config_path):
            console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
            raise typer.Exit(code=1)
        asyncio.run(_skill_list_async(data_dir))

    @skill_app.command("run")
    def skill_run(
        name: str = typer.Argument(..., help="Skill name to execute"),
        inputs: list[str] = typer.Option([], "--input", "-i", help="Input key=value"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        config_path = os.path.join(data_dir, "cabinet.json")
        if not os.path.exists(config_path):
            console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
            raise typer.Exit(code=1)
        parsed_inputs = {}
        for item in inputs:
            k, v = item.split("=", 1)
            parsed_inputs[k] = v
        asyncio.run(_skill_run_async(name, parsed_inputs, data_dir))

    app.add_typer(skill_app, name="skill")


async def _skill_load_async(path: str, data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.tools.registry import LocalToolRegistry
    from cabinet.core.tools.skill_store import SkillStore

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    registry = LocalToolRegistry()
    store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    skill = await store.load_skill(path, registry)
    console.print(f"[green]Skill '{skill.name}' loaded.[/green]")


async def _skill_list_async(data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.tools.registry import LocalToolRegistry
    from cabinet.core.tools.skill_store import SkillStore

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    registry = LocalToolRegistry()
    store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    await store.initialize(registry)
    skills = await registry.list_skills()

    table = Table(title="Skills")
    table.add_column("Name", style="cyan")
    table.add_column("Kind", style="green")
    table.add_column("Description")
    table.add_column("Knowledge", style="yellow")

    for s in skills:
        table.add_row(
            s.name,
            s.kind,
            s.description[:50],
            "Yes" if s.requires_knowledge else "No",
        )
    console.print(table)


async def _skill_run_async(name: str, inputs: dict, data_dir: str):
    from cabinet.cli.main import _init_runtime

    runtime, config = await _init_runtime(data_dir)
    try:
        output = await runtime.tool_registry.execute(name, inputs)
        console.print(Panel(output.content, title=f"Skill: {name}"))
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
    finally:
        await runtime.stop()
