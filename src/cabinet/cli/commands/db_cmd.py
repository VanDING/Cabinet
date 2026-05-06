from __future__ import annotations

import asyncio
import os

import typer
from rich.console import Console

console = Console()

db_app = typer.Typer(name="db", help="Database management")


def register(app):
    @db_app.command("migrate")
    def db_migrate(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
        dry_run: bool = typer.Option(False, "--dry-run", help="Preview pending migrations without executing"),
    ):
        asyncio.run(_db_migrate_async(data_dir, dry_run))

    @db_app.command("version")
    def db_version(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_db_version_async(data_dir))

    @db_app.command("rollback")
    def db_rollback(
        target_version: int = typer.Argument(..., help="Target schema version to rollback to"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_db_rollback_async(target_version, data_dir))

    app.add_typer(db_app, name="db")


async def _db_migrate_async(data_dir: str, dry_run: bool = False) -> None:
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.loader import load_all_migrations

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    _migrations = load_all_migrations()

    runner = MigrationRunner(db_path, _migrations)
    await runner.initialize()
    current = await runner.current_version()

    if dry_run:
        pending = await runner.pending_migrations()
        await runner.close()
        if not pending:
            console.print(f"[green]Database is up to date (version {current}). No pending migrations.[/green]")
        else:
            console.print(f"[bold]Current version:[/bold] {current}")
            console.print(f"[bold]Pending migrations:[/bold] {len(pending)}")
            for m in pending:
                console.print(f"  v{m.version:03d}: {m.description}")
        return

    if current == 0 or any(m.version > current for m in _migrations):
        from cabinet.core.backup import BackupManager
        manager = BackupManager(data_dir)
        try:
            metadata = await manager.create_backup(label="pre-migration")
            console.print(f"  Pre-migration backup: {metadata.backup_path}")
        except Exception as e:
            console.print(f"[yellow]Warning:[/yellow] Pre-migration backup failed: {e}")

    await runner.run_pending()
    new_version = await runner.current_version()
    await runner.close()

    if current == new_version:
        console.print(f"[green]Database is up to date (version {current}).[/green]")
    else:
        console.print(f"[green]Migrated from version {current} to {new_version}.[/green]")


async def _db_version_async(data_dir: str) -> None:
    from cabinet.core.events.migrations import MigrationRunner

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    runner = MigrationRunner(db_path, [])
    await runner.initialize()
    version = await runner.current_version()
    await runner.close()
    console.print(f"Schema version: {version}")


async def _db_rollback_async(target_version: int, data_dir: str) -> None:
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.loader import load_all_migrations

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    _migrations = load_all_migrations()

    runner = MigrationRunner(db_path, _migrations)
    await runner.initialize()
    await runner.rollback_to(target_version)
    version = await runner.current_version()
    await runner.close()
    console.print(f"[green]Rolled back to schema version {version}.[/green]")
