from __future__ import annotations

import asyncio
import os

import typer
from rich.console import Console

console = Console()


def register(app):
    @app.command()
    def chat(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        config_path = os.path.join(data_dir, "cabinet.json")
        if not os.path.exists(config_path):
            console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
            raise typer.Exit(code=1)

        from cabinet.cli.main import _chat_async
        asyncio.run(_chat_async(data_dir))
