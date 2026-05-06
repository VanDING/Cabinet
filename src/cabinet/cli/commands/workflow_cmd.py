from __future__ import annotations

import asyncio
import os

import aiosqlite
import typer
from rich.console import Console

console = Console()

workflow_app = typer.Typer(name="workflow", help="Workflow management")


def register(app):
    @workflow_app.command("list-versions")
    def workflow_list_versions(
        workflow_id: str = typer.Argument(..., help="Workflow ID"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_workflow_list_versions_async(workflow_id, data_dir))

    @workflow_app.command("visualize")
    def workflow_visualize(
        workflow_id: str = typer.Argument(..., help="Workflow ID"),
        version: int = typer.Option(0, "--version", "-v", help="Version number (0=latest)"),
        format: str = typer.Option("mermaid", "--format", "-f", help="Output format: mermaid, json"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_workflow_visualize_async(workflow_id, version, format, data_dir))

    @workflow_app.command("show-version")
    def workflow_show_version(
        workflow_id: str = typer.Argument(..., help="Workflow ID"),
        version: int = typer.Argument(..., help="Version number"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_workflow_show_version_async(workflow_id, version, data_dir))

    app.add_typer(workflow_app, name="workflow")


async def _workflow_list_versions_async(workflow_id: str, data_dir: str) -> None:
    from uuid import UUID
    from cabinet.core.workflow.version_store import WorkflowVersionStore

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    db = await aiosqlite.connect(db_path)
    try:
        store = WorkflowVersionStore(db)
        versions = await store.list_versions(UUID(workflow_id))
        if not versions:
            console.print("[yellow]No versions found.[/yellow]")
            return
        for v in versions:
            console.print(f"  v{v['version']} | {v['created_at']} | checksum={v['checksum'][:12]}...")
    finally:
        await db.close()


async def _workflow_visualize_async(workflow_id: str, version: int, format: str, data_dir: str) -> None:
    from uuid import UUID
    from cabinet.core.workflow.version_store import WorkflowVersionStore
    from cabinet.core.workflow.visualizer import WorkflowVisualizer
    from cabinet.models.workflows import Workflow

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    db = await aiosqlite.connect(db_path)
    try:
        store = WorkflowVersionStore(db)
        if version == 0:
            record = await store.get_latest(UUID(workflow_id))
        else:
            record = await store.get_version(UUID(workflow_id), version)
        if record is None:
            console.print("[yellow]Workflow version not found.[/yellow]")
            return

        workflow = Workflow.model_validate_json(record["definition"])
        viz = WorkflowVisualizer()
        if format == "json":
            console.print(viz.to_json(workflow))
        else:
            console.print(viz.to_mermaid(workflow))
    finally:
        await db.close()


async def _workflow_show_version_async(workflow_id: str, version: int, data_dir: str) -> None:
    from uuid import UUID
    from cabinet.core.workflow.version_store import WorkflowVersionStore

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    db = await aiosqlite.connect(db_path)
    try:
        store = WorkflowVersionStore(db)
        record = await store.get_version(UUID(workflow_id), version)
        if record is None:
            console.print(f"[yellow]Version {version} not found.[/yellow]")
            return
        console.print(f"Version: {record['version']}")
        console.print(f"Checksum: {record['checksum']}")
        console.print(f"Created: {record['created_at']}")
        console.print(f"Definition:\n{record['definition']}")
    finally:
        await db.close()
