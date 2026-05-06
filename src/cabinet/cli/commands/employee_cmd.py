from __future__ import annotations

import asyncio
import os

import typer
from rich.console import Console
from rich.table import Table

console = Console()

employee_app = typer.Typer(name="employee", help="Manage employees")


def register(app):
    @employee_app.command("add")
    def employee_add(
        name: str = typer.Option(..., "--name", help="Employee name"),
        role: str = typer.Option(..., "--role", help="Employee role"),
        personality: str = typer.Option("", "--personality", help="Employee personality"),
        kind: str = typer.Option("ai", "--kind", help="Employee kind (ai/human)"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        config_path = os.path.join(data_dir, "cabinet.json")
        if not os.path.exists(config_path):
            console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
            raise typer.Exit(code=1)
        asyncio.run(_employee_add_async(name, role, personality, kind, data_dir))

    @employee_app.command("list")
    def employee_list(
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        config_path = os.path.join(data_dir, "cabinet.json")
        if not os.path.exists(config_path):
            console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
            raise typer.Exit(code=1)
        asyncio.run(_employee_list_async(data_dir))

    app.add_typer(employee_app, name="employee")


async def _employee_add_async(name: str, role: str, personality: str, kind: str, data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import DEFAULT_ROLE_PROMPTS
    from cabinet.cli.config import load_config
    from cabinet.models.primitives import Employee
    from uuid import uuid5, NAMESPACE_DNS

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
    await store.initialize()

    team_id = uuid5(NAMESPACE_DNS, f"team:{role}")
    emp_personality = personality or DEFAULT_ROLE_PROMPTS.get(role, "")
    employee = Employee(
        team_id=team_id,
        name=name,
        role=role,
        kind=kind,
        personality=emp_personality,
    )
    await store.add(employee)
    console.print(f"[green]Employee '{name}' added.[/green] (ID: {employee.id}, Role: {role})")


async def _employee_list_async(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.cli.config import load_config

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
    await store.initialize()
    employees = await store.list_all()

    table = Table(title="Employees")
    table.add_column("ID", style="dim")
    table.add_column("Name", style="cyan")
    table.add_column("Role", style="green")
    table.add_column("Kind")
    table.add_column("Skills", style="yellow")

    for emp in employees:
        table.add_row(
            str(emp.id)[:8],
            emp.name,
            emp.role,
            emp.kind,
            str(len(emp.skills)),
        )
    console.print(table)
