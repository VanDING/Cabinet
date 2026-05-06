from __future__ import annotations

import asyncio
import signal

import typer
from rich.console import Console

console = Console()

backup_app = typer.Typer(name="backup", help="Backup management")


def register(app):
    @backup_app.command("create")
    def backup_create(
        label: str = typer.Option("", "--label", help="Backup label"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_backup_create_async(label, data_dir))

    @backup_app.command("list")
    def backup_list(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_backup_list_async(data_dir))

    @backup_app.command("restore")
    def backup_restore(
        backup_path: str = typer.Argument(..., help="Path to backup file"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_backup_restore_async(backup_path, data_dir))

    @backup_app.command("delete")
    def backup_delete(
        backup_path: str = typer.Argument(..., help="Path to backup file"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_backup_delete_async(backup_path, data_dir))

    @backup_app.command("schedule")
    def backup_schedule(
        interval: float = typer.Option(24, "--interval", help="Backup interval in hours"),
        max_backups: int = typer.Option(10, "--max-backups", help="Maximum scheduled backups to keep"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        asyncio.run(_backup_schedule_async(interval, max_backups, data_dir))

    @backup_app.command("unschedule")
    def backup_unschedule(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        console.print("[yellow]Scheduled backup is not running in this process.[/yellow]")
        console.print("[dim]To stop a running schedule, use Ctrl+C in the terminal running 'cabinet backup schedule'[/dim]")

    app.add_typer(backup_app, name="backup")


async def _backup_create_async(label: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    metadata = await manager.create_backup(label=label)
    console.print(f"[green]Backup created:[/green] {metadata.backup_path}")
    console.print(f"  Size: {metadata.file_size} bytes | Schema: v{metadata.schema_version}")


async def _backup_list_async(data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    backups = await manager.list_backups()
    if not backups:
        console.print("[yellow]No backups found.[/yellow]")
        return
    for b in backups:
        console.print(f"  {b.backup_path} | {b.created_at} | {b.file_size} bytes | schema v{b.schema_version}")


async def _backup_restore_async(backup_path: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    await manager.restore_backup(backup_path)
    console.print(f"[green]Restored from:[/green] {backup_path}")


async def _backup_delete_async(backup_path: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    await manager.delete_backup(backup_path)
    console.print(f"[green]Deleted backup:[/green] {backup_path}")


async def _backup_schedule_async(interval: float, max_backups: int, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager, ScheduledBackupManager

    manager = BackupManager(data_dir)
    scheduled = ScheduledBackupManager(manager, interval_hours=interval, max_backups=max_backups)
    console.print(f"[green]Starting scheduled backup[/green] (every {interval}h, max {max_backups} backups)")
    console.print("[dim]Press Ctrl+C to stop[/dim]")
    await scheduled.start()
    try:
        event = asyncio.Event()
        signal.signal(signal.SIGINT, lambda *_: event.set())
        signal.signal(signal.SIGTERM, lambda *_: event.set())
        await event.wait()
    except (KeyboardInterrupt, RuntimeError):
        pass
    finally:
        await scheduled.stop()
    console.print("[green]Scheduled backup stopped[/green]")
