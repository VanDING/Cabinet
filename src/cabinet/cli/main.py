from __future__ import annotations

import os
from uuid import uuid4

import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.table import Table

from cabinet import __version__
from cabinet.cli.commands import register_all

app = typer.Typer(name="cabinet", help="Cabinet - AI Collaboration Framework")
console = Console()


@app.callback()
def main():
    from cabinet.core.observability import set_cli_request_id
    set_cli_request_id()


@app.command()
def version():
    console.print(f"Cabinet v{__version__}")


# ── shared helpers used by command modules ──

async def _init_db(db_path: str) -> None:
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
    store = SQLiteMemoryStore(db_path=db_path)
    await store.initialize()
    await store.close()


async def _preflight_check_async(data_dir: str) -> None:
    try:
        runtime, _ = await _init_runtime(data_dir)
        result = await runtime.preflight_check()
        await runtime.stop()

        table = Table(title="Preflight Check")
        table.add_column("Check", style="cyan")
        table.add_column("Status", style="green")
        for key, value in result.items():
            style = "green" if value == "ok" or value.startswith("ok(") else "yellow" if value == "not_configured" else "red"
            table.add_row(key, f"[{style}]{value}[/{style}]")
        console.print(table)
    except Exception as e:
        console.print(f"[red]Preflight check failed:[/red] {e}")


def _load_model_list(data_dir: str, config: object) -> list[dict]:
    import json as _json
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST

    model_config_file = os.path.join(data_dir, config.model_config_path)
    if os.path.exists(model_config_file):
        with open(model_config_file) as f:
            return _json.load(f)
    return DEFAULT_MODEL_LIST


def _update_models_json(models_path: str, new_entry: dict, model_alias: str = "default"):
    import json as _json

    if os.path.exists(models_path):
        with open(models_path) as f:
            model_list = _json.load(f)
    else:
        model_list = []
    replaced = False
    for i, entry in enumerate(model_list):
        if entry.get("model_name") == model_alias:
            model_list[i] = new_entry
            replaced = True
            break
    if not replaced:
        model_list.append(new_entry)
    with open(models_path, "w") as f:
        _json.dump(model_list, f, indent=2)


def _load_and_decrypt_keys(api_keys: dict, vault) -> dict[str, str]:
    decrypted_keys: dict[str, str] = {}
    for provider_id, key in api_keys.items():
        if key.startswith("vault:"):
            decrypted_keys[provider_id] = vault.decrypt(key)
        else:
            decrypted_keys[provider_id] = key
    return decrypted_keys


def _create_gateway(model_list: list, api_keys: dict):
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    return LiteLLMRouterGateway(model_list=model_list, api_keys=api_keys)


def _create_memory_store(config, data_dir: str, db_path: str):
    if config.memory_type == "sqlite":
        from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
        return SQLiteMemoryStore(db_path=db_path)
    from cabinet.core.memory.vector_store import ChromaDBMemoryStore
    return ChromaDBMemoryStore(persist_dir=os.path.join(data_dir, "vectors"))


async def _create_mcp_connector(mcp_servers: list):
    if not mcp_servers:
        return None
    from cabinet.core.tools.mcp_connector import MCPConnector
    connector = MCPConnector()
    for server_config in mcp_servers:
        await connector.connect_server(**server_config.model_dump())
    return connector


async def _init_runtime(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config, save_config
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
    from cabinet.core.tools.skill_store import SkillStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    import logging as _logging
    _migration_logger = _logging.getLogger("cabinet.cli")

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)

    decrypted_keys = _load_and_decrypt_keys(config.api_keys, vault)

    migrated = False
    for provider_id, key in config.api_keys.items():
        if not key.startswith("vault:"):
            encrypted = vault.encrypt(key)
            config.api_keys[provider_id] = f"vault:{encrypted}"
            migrated = True
    if migrated:
        save_config(config, os.path.join(data_dir, "cabinet.json"))
        _migration_logger.info("migrated plaintext API key(s) to vault encryption")

    model_list = _load_model_list(data_dir, config)
    gateway = _create_gateway(model_list, decrypted_keys)
    memory_store = _create_memory_store(config, data_dir, db_path)

    employee_store = JsonEmployeeStore(
        path=os.path.join(data_dir, config.employees_path)
    )
    await employee_store.initialize()

    agent_factory = LLMAgentFactory(
        gateway, memory_store=memory_store, employee_store=employee_store
    )

    knowledge_base = ChromaDBKnowledgeBase(
        persist_dir=os.path.join(data_dir, "vectors"),
    )

    kwargs: dict = {
        "agent_factory": agent_factory,
        "db_path": db_path,
        "memory_store": memory_store,
        "gateway": gateway,
        "knowledge_base": knowledge_base,
        "employee_store": employee_store,
    }
    mcp_connector = await _create_mcp_connector(config.mcp_servers)
    if mcp_connector:
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)

    skill_store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    await skill_store.initialize(runtime.tool_registry)

    await runtime.start()
    return runtime, config


async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.app import CabinetApp

    runtime, config = await _init_runtime(data_dir)
    try:
        app = CabinetApp(runtime, config, data_dir)
        await app.run_async()
    finally:
        await runtime.stop()


async def _init_agent_runtime(data_dir: str):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        return None
    try:
        runtime, _ = await _init_runtime(data_dir)
        return runtime
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        return None


def _print_help():
    table = Table(title="Available Commands")
    table.add_column("Command", style="cyan")
    table.add_column("Description", style="green")
    commands = [
        ("/meeting <topic>", "Start a deliberation session"),
        ("/decide <title>", "Submit a decision request"),
        ("/task <description>", "Submit an execution task"),
        ("/strategy <proposal>", "Decode a strategy proposal"),
        ("/review", "Start a review session"),
        ("/skills", "List available skills"),
        ("/employees", "List registered employees"),
        ("/status", "Show pending summary"),
        ("/help", "Show this help"),
        ("/quit", "Exit chat"),
    ]
    for cmd, desc in commands:
        table.add_row(cmd, desc)
    console.print(table)


async def _handle_meeting(runtime, topic: str):
    from cabinet.rooms.meeting.models import MeetingLevel

    participants = [uuid4(), uuid4()]
    session = await runtime.meeting.start_session(
        topic=topic, level=MeetingLevel.MULTI_PARTY, participants=participants
    )
    console.print(f"[dim]Deliberation session started: {session.id}[/dim]")
    for pid in participants:
        await runtime.meeting.add_perspective(session.id, pid)
    await runtime.meeting.cross_validate(session.id)
    result = await runtime.meeting.converge(session.id)
    console.print(Markdown(result.proposal_text))
    console.print()


async def _handle_decide(runtime, title: str):
    from cabinet.models.events import DecisionRequest
    from cabinet.models.decisions import DecisionType

    request = DecisionRequest(
        decision_id=uuid4(),
        decision_type=DecisionType.STRATEGIC.value,
        title=title,
        options=[{"label": "Approve"}, {"label": "Reject"}],
    )
    decision = await runtime.decision.submit(request)
    console.print(Markdown(f"**Decision submitted:** {decision.title}\n\n{decision.description[:200]}"))
    console.print()


async def _handle_task(runtime, description: str):
    from cabinet.models.events import TaskOrder

    order = TaskOrder(
        employee_id=uuid4(),
        skill_id=uuid4(),
        inputs={"description": description},
    )
    task = await runtime.office.submit_task(order)
    console.print(Markdown(f"**Task submitted:** {task.id}\nStatus: {task.status}"))
    console.print()


async def _handle_strategy(runtime, proposal: str):
    from cabinet.rooms.strategy.models import DecodeContext
    from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult
    from cabinet.rooms.meeting.models import ConvergenceResult

    session_id = uuid4()
    proposal_output = DeliberationOutput(
        session_id=session_id,
        proposal=DeliberationResult(
            session_id=session_id,
            proposal_text=proposal,
            confidence=0.8,
            reasoning_summary="direct input",
            convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
            rounds_used=1,
            rumination_detected=False,
        ),
    )
    context = DecodeContext(project_id=uuid4(), captain_id="captain", existing_constraints=[])
    blueprint = await runtime.strategy.decode(proposal_output, context)
    console.print(Markdown(f"**Blueprint decoded:** {blueprint.id}\nDomains: {', '.join(d.name for d in blueprint.domains)}"))
    console.print()


async def _handle_review(runtime, config):
    from cabinet.rooms.summary.models import ReviewType

    session = await runtime.summary.start_review(
        project_id=config.default_project, review_type=ReviewType.PROJECT
    )
    insights = await runtime.summary.generate_insights(session.id)
    for insight in insights:
        console.print(Markdown(f"- {insight.content}"))
    console.print()


async def _handle_skills(runtime):
    skills = await runtime.tool_registry.list_skills()
    table = Table(title="Available Skills")
    table.add_column("Name", style="cyan")
    table.add_column("Description")
    for s in skills:
        table.add_row(s.name, s.description[:60])
    if not skills:
        console.print("[yellow]No skills loaded. Use 'cabinet skill load <path>' to add skills.[/yellow]")
    else:
        console.print(table)


async def _handle_employees(runtime):
    if runtime.employee_store is None:
        console.print("[yellow]No employee store configured.[/yellow]")
        return
    employees = await runtime.employee_store.list_all()
    table = Table(title="Registered Employees")
    table.add_column("Name", style="cyan")
    table.add_column("Role", style="green")
    table.add_column("Kind")
    for emp in employees:
        table.add_row(emp.name, emp.role, emp.kind)
    if not employees:
        console.print("[yellow]No employees registered. Use 'cabinet employee add' to add employees.[/yellow]")
    else:
        console.print(table)


# ── register all command modules ──

register_all(app)


if __name__ == "__main__":
    app()
