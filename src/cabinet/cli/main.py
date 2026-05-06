from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import typer
from rich.console import Console
from rich.panel import Panel

from cabinet import __version__

app = typer.Typer(name="cabinet", help="Cabinet - AI Collaboration Framework")
console = Console()


@app.callback()
def main():
    from cabinet.core.observability import set_cli_request_id
    set_cli_request_id()


@app.command()
def version():
    console.print(f"Cabinet v{__version__}")


@app.command()
def init(
    name: str = typer.Argument(..., help="Organization name"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if os.path.exists(config_path):
        console.print(f"[red]Error:[/red] Cabinet already initialized at {data_dir}")
        raise typer.Exit(code=1)

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    org = Organization(name=name, captain_id="captain")
    project = Project(
        organization_id=org.id,
        name=f"{name} Default Project",
        description="Default project for the organization",
    )
    org.projects.append(project.id)

    config = CabinetConfig(organization=org, default_project=project.id)

    Path(data_dir).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "db")).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "vectors")).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "knowledge")).mkdir(parents=True, exist_ok=True)
    Path(os.path.join(data_dir, "skills")).mkdir(parents=True, exist_ok=True)

    save_config(config, config_path)

    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST

    models_path = os.path.join(data_dir, "models.json")
    with open(models_path, "w") as f:
        import json as _json

        _json.dump(DEFAULT_MODEL_LIST, f, indent=2)

    asyncio.run(_init_db(os.path.join(data_dir, "db", "cabinet.db")))

    console.print(
        Panel(
            f"[bold green]Cabinet initialized![/bold green]\n\n"
            f"Organization: {name}\n"
            f"Captain ID: captain\n"
            f"Data directory: {data_dir}\n\n"
            f"[bold]Next steps:[/bold]\n"
            f"1. Setup LLM provider:  cabinet setup-provider\n"
            f"2. Start chatting:      cabinet chat",
            title="Cabinet Init",
        )
    )


@app.command()
def status(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    preflight: bool = typer.Option(False, "--preflight", help="Run preflight dependency checks"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.cli.config import load_config
    from rich.table import Table

    config = load_config(config_path)

    table = Table(title="Cabinet Status")
    table.add_column("Property", style="cyan")
    table.add_column("Value", style="green")
    table.add_row("Organization", config.organization.name)
    table.add_row("Captain ID", config.organization.captain_id)
    table.add_row("Created", config.created_at.strftime("%Y-%m-%d %H:%M:%S"))
    table.add_row("Data Directory", data_dir)

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if os.path.exists(db_path):
        db_size = os.path.getsize(db_path)
        table.add_row("DB Size", f"{db_size} bytes")
    else:
        table.add_row("DB Size", "Not created")

    console.print(table)

    if preflight:
        asyncio.run(_preflight_check_async(data_dir))


@app.command()
def set_api_key(
    key: str = typer.Argument(..., help="API key to store"),
    provider: str = typer.Option("openai", "--provider", help="Provider name"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    console.print("[yellow]Warning:[/yellow] 'set-api-key' is deprecated. Use 'cabinet setup-provider' instead.")
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)
    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(key)
    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)
    console.print(f"[green]API key for '{provider}' stored securely in vault.[/green]")


@app.command("setup-provider")
def setup_provider(
    provider: str = typer.Option(None, "--provider", help="服务商 ID (deepseek/qwen/glm/openai/anthropic)"),
    model: str = typer.Option(None, "--model", help="模型名称"),
    api_key: str = typer.Option(None, "--api-key", help="API Key"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.cli.providers import PROVIDER_REGISTRY, build_model_entry

    if provider is None:
        console.print("[bold]选择 LLM 服务商:[/bold]")
        provider_ids = list(PROVIDER_REGISTRY.keys())
        for i, pid in enumerate(provider_ids, 1):
            preset = PROVIDER_REGISTRY[pid]
            console.print(f"  {i}. {preset.display_name}")
        console.print(f"  {len(provider_ids) + 1}. 自定义 (OpenAI 兼容)")
        choice = typer.prompt("输入编号", type=int)
        if choice < 1 or choice > len(provider_ids) + 1:
            console.print("[red]Error:[/red] 无效选择")
            raise typer.Exit(code=1)
        if choice <= len(provider_ids):
            provider = provider_ids[choice - 1]
        else:
            provider = "_custom"

    if provider == "_custom":
        litellm_prefix = typer.prompt("LiteLLM 前缀 (通常为 openai)", default="openai")
        custom_base_url = typer.prompt("API Base URL")
        custom_model = typer.prompt("模型名称")
        if api_key is None:
            api_key = typer.prompt("API Key", hide_input=True)
        if not api_key:
            console.print("[red]Error:[/red] API Key 不能为空")
            raise typer.Exit(code=1)

        from cabinet.core.security import KeyVault
        master_key_path = os.path.join(data_dir, ".master_key")
        vault = KeyVault(key_file=master_key_path)
        encrypted = vault.encrypt(api_key)

        from cabinet.cli.config import load_config, save_config
        cfg = load_config(config_path)
        cfg.api_keys["custom"] = f"vault:{encrypted}"
        save_config(cfg, config_path)

        custom_entry = {
            "model_name": "default",
            "litellm_params": {
                "model": f"{litellm_prefix}/{custom_model}",
                "api_base": custom_base_url,
            },
        }
        models_path = os.path.join(data_dir, "models.json")
        _update_models_json(models_path, custom_entry, model_alias="default")

        console.print("\n  [green]自定义服务商配置完成![/green]")
        console.print(f"  模型: {litellm_prefix}/{custom_model}")
        console.print(f"  API Key: {api_key[:8]}*** (已加密存储)")
        console.print("\n  你现在可以运行 [bold]cabinet chat[/bold] 开始对话。")
        return

    preset = PROVIDER_REGISTRY.get(provider)
    if preset is None:
        console.print(f"[red]Error:[/red] 未知服务商 '{provider}'。可用: {', '.join(PROVIDER_REGISTRY.keys())}")
        raise typer.Exit(code=1)

    if model is None:
        console.print(f"\n[bold]选择模型 ({preset.display_name}):[/bold]")
        for i, m in enumerate(preset.models, 1):
            suffix = " (推荐)" if m == preset.default_model else ""
            console.print(f"  {i}. {m}{suffix}")
        console.print(f"  {len(preset.models) + 1}. 手动输入模型名")
        choice = typer.prompt("输入编号", type=int)
        if choice < 1 or choice > len(preset.models) + 1:
            console.print("[red]Error:[/red] 无效选择")
            raise typer.Exit(code=1)
        if choice <= len(preset.models):
            model = preset.models[choice - 1]
        else:
            model = typer.prompt("输入模型名称")

    if api_key is None:
        api_key = typer.prompt("API Key", hide_input=True)
    if not api_key:
        console.print("[red]Error:[/red] API Key 不能为空")
        raise typer.Exit(code=1)

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(api_key)

    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)

    model_entry = build_model_entry(preset, model)
    models_path = os.path.join(data_dir, "models.json")
    _update_models_json(models_path, model_entry, model_alias="default")

    console.print(f"\n  [green]{preset.display_name} 配置完成![/green]")
    console.print(f"  模型: {model_entry['litellm_params']['model']}")
    console.print(f"  API Key: {api_key[:8]}*** (已加密存储)")
    console.print("\n  你现在可以运行 [bold]cabinet chat[/bold] 开始对话。")


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", "--host", help="Host to bind"),
    port: int = typer.Option(8000, "--port", help="Port to bind"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    log_level = os.environ.get("CABINET_LOG_LEVEL", "INFO").upper()
    from cabinet.core.observability import ObservabilityConfig, setup_observability

    obs_config = ObservabilityConfig(
        enabled=True,
        log_level=log_level,
        log_format=os.environ.get("CABINET_LOG_FORMAT", "json"),
        otlp_endpoint=os.environ.get("CABINET_OTLP_ENDPOINT"),
        prometheus_port=int(os.environ.get("CABINET_PROMETHEUS_PORT", "9090")),
    )
    setup_observability(obs_config)

    import uvicorn
    from cabinet.api.app import create_app

    async def _create_and_serve():
        runtime, config = await _init_runtime(data_dir)
        api_app = create_app(runtime, config)
        if config.observability.enabled:
            from prometheus_client import start_http_server
            start_http_server(config.observability.prometheus_port)
        uv_config = uvicorn.Config(api_app, host=host, port=port)
        server = uvicorn.Server(uv_config)

        import signal

        loop = asyncio.get_running_loop()

        def _signal_handler():
            server.should_exit = True

        if os.name != "nt":
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(sig, _signal_handler)

        try:
            await server.serve()
        finally:
            if os.name != "nt":
                for sig in (signal.SIGINT, signal.SIGTERM):
                    try:
                        loop.remove_signal_handler(sig)
                    except Exception:
                        pass
            await runtime.stop()

    asyncio.run(_create_and_serve())


@app.command()
def chat(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_chat_async(data_dir))


@app.command()
def config(
    action: str = typer.Argument(..., help="Action: set-key, get-key, list-keys, set-token, get-token"),
    key: str = typer.Argument(None, help="Provider name or key name"),
    value: str = typer.Argument(None, help="API key value (for set-key)"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.cli.config import load_config, save_config

    cfg = load_config(config_path)

    if action == "set-key":
        if key is None or value is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-key <provider> <api-key>")
            raise typer.Exit(code=1)
        console.print("[yellow]Warning:[/yellow] 'config set-key' is deprecated. Use 'cabinet set-api-key' instead.")
        from cabinet.core.security import KeyVault
        master_key_path = os.path.join(data_dir, ".master_key")
        vault = KeyVault(key_file=master_key_path)
        encrypted = vault.encrypt(value)
        cfg.api_keys[key] = f"vault:{encrypted}"
        save_config(cfg, config_path)
        console.print(f"[green]API key for '{key}' stored securely in vault.[/green]")

    elif action == "get-key":
        if key is None:
            console.print("[red]Error:[/red] Usage: cabinet config get-key <provider>")
            raise typer.Exit(code=1)
        if key not in cfg.api_keys:
            console.print(f"[red]Error:[/red] No API key found for '{key}'")
            raise typer.Exit(code=1)
        masked = cfg.api_keys[key][:8] + "***" if len(cfg.api_keys[key]) > 8 else "***"
        console.print(f"{key}: {masked}")

    elif action == "list-keys":
        if not cfg.api_keys:
            console.print("No API keys configured.")
        else:
            for provider, api_key in cfg.api_keys.items():
                masked = api_key[:8] + "***" if len(api_key) > 8 else "***"
                console.print(f"  {provider}: {masked}")

    elif action == "set-token":
        if key is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-token <token>")
            raise typer.Exit(code=1)
        import hashlib as _hashlib
        token_hash = _hashlib.sha256(key.encode()).hexdigest()
        cfg.api_token = f"sha256:{token_hash}"
        save_config(cfg, config_path)
        console.print("[green]API token saved (hashed).[/green]")

    elif action == "get-token":
        if not cfg.api_token:
            console.print("[yellow]No API token configured.[/yellow]")
        else:
            masked = cfg.api_token[:8] + "***" if len(cfg.api_token) > 8 else "***"
            console.print(f"API token: {masked}")

    else:
        console.print(
            f"[red]Error:[/red] Unknown action '{action}'. Use: set-key, get-key, list-keys, set-token, get-token"
        )
        raise typer.Exit(code=1)


async def _init_db(db_path: str) -> None:
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore

    store = SQLiteMemoryStore(db_path=db_path)
    await store.initialize()
    await store.close()


async def _preflight_check_async(data_dir: str) -> None:
    from rich.table import Table

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


async def _init_runtime(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config, save_config
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
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

    from cabinet.cli.providers import PROVIDER_REGISTRY

    migrated = False
    for provider_id, key in config.api_keys.items():
        if key.startswith("vault:"):
            decrypted = vault.decrypt(key[6:])
        else:
            decrypted = key
            encrypted = vault.encrypt(key)
            config.api_keys[provider_id] = f"vault:{encrypted}"
            migrated = True
        preset = PROVIDER_REGISTRY.get(provider_id)
        env_name = preset.api_key_env if preset else f"{provider_id.upper()}_API_KEY"
        os.environ.setdefault(env_name, decrypted)
    if migrated:
        save_config(config, os.path.join(data_dir, "cabinet.json"))
        _migration_logger.info("migrated plaintext API key(s) to vault encryption")

    model_list = _load_model_list(data_dir, config)
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)

    if config.memory_type == "sqlite":
        from cabinet.core.memory.sqlite_store import SQLiteMemoryStore

        memory_store = SQLiteMemoryStore(db_path=db_path)
    else:
        from cabinet.core.memory.vector_store import ChromaDBMemoryStore

        memory_store = ChromaDBMemoryStore(
            persist_dir=os.path.join(data_dir, "vectors"),
        )

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
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector

        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config.model_dump())
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)

    skill_store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    await skill_store.initialize(runtime.tool_registry)

    await runtime.start()
    return runtime, config


async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.tui import run_cockpit, run_welcome_screen

    runtime, config = await _init_runtime(data_dir)

    try:
        await run_welcome_screen(console, runtime)
        await run_cockpit(console, runtime, config)
    finally:
        await runtime.stop()


def _print_help():
    from rich.table import Table

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
    from rich.markdown import Markdown

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
    from rich.markdown import Markdown

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
    from rich.markdown import Markdown

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
    from rich.markdown import Markdown

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
    from rich.markdown import Markdown

    session = await runtime.summary.start_review(
        project_id=config.default_project, review_type=ReviewType.PROJECT
    )
    insights = await runtime.summary.generate_insights(session.id)
    for insight in insights:
        console.print(Markdown(f"- {insight.content}"))
    console.print()


async def _handle_skills(runtime):
    from rich.table import Table

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
    from rich.table import Table

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


employee_app = typer.Typer(name="employee", help="Manage employees")
app.add_typer(employee_app, name="employee")


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


@employee_app.command("list")
def employee_list(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_employee_list_async(data_dir))


async def _employee_list_async(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.cli.config import load_config
    from rich.table import Table

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


skill_app = typer.Typer(name="skill", help="Manage skills")
app.add_typer(skill_app, name="skill")


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


async def _skill_load_async(path: str, data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.tools.registry import LocalToolRegistry
    from cabinet.core.tools.skill_store import SkillStore

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    registry = LocalToolRegistry()
    store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    skill = await store.load_skill(path, registry)
    console.print(f"[green]Skill '{skill.name}' loaded.[/green]")


@skill_app.command("list")
def skill_list(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_skill_list_async(data_dir))


async def _skill_list_async(data_dir: str):
    from cabinet.cli.config import load_config
    from cabinet.core.tools.registry import LocalToolRegistry
    from cabinet.core.tools.skill_store import SkillStore
    from rich.table import Table

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


async def _skill_run_async(name: str, inputs: dict, data_dir: str):
    runtime, config = await _init_runtime(data_dir)
    try:
        output = await runtime.tool_registry.execute(name, inputs)
        console.print(Panel(output.content, title=f"Skill: {name}"))
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
    finally:
        await runtime.stop()


knowledge_app = typer.Typer(name="knowledge", help="Manage knowledge base")
app.add_typer(knowledge_app, name="knowledge")


@knowledge_app.command("index")
def knowledge_index(
    path: str = typer.Argument(..., help="Path to file or directory to index"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_knowledge_index_async(path, data_dir))


async def _knowledge_index_async(path: str, data_dir: str):
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase

    kb = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))
    try:
        p = Path(path)
        documents = []
        if p.is_file():
            content = p.read_text(encoding="utf-8")
            documents.append({"content": content, "source": str(p)})
        elif p.is_dir():
            for f in p.rglob("*.md"):
                content = f.read_text(encoding="utf-8")
                documents.append({"content": content, "source": str(f)})
            for f in p.rglob("*.txt"):
                content = f.read_text(encoding="utf-8")
                documents.append({"content": content, "source": str(f)})

        if not documents:
            console.print("[yellow]No documents found to index.[/yellow]")
            return

        await kb.index(documents)
        console.print(f"[green]Indexed {len(documents)} document(s).[/green]")
    finally:
        kb.close()


@knowledge_app.command("query")
def knowledge_query(
    question: str = typer.Argument(..., help="Question to ask"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    asyncio.run(_knowledge_query_async(question, data_dir))


async def _knowledge_query_async(question: str, data_dir: str):
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase

    kb = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))
    try:
        chunks = await kb.query(question, top_k=3)

        if not chunks:
            console.print("[yellow]No results found.[/yellow]")
            return

        for i, chunk in enumerate(chunks, 1):
            console.print(Panel(
                chunk.content[:500],
                title=f"Result {i} (source: {chunk.source})",
            ))
    finally:
        kb.close()


db_app = typer.Typer(name="db", help="Database management")
app.add_typer(db_app, name="db")


@db_app.command("migrate")
def db_migrate(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview pending migrations without executing"),
):
    asyncio.run(_db_migrate_async(data_dir, dry_run))


async def _db_migrate_async(data_dir: str, dry_run: bool = False) -> None:
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    _migrations = [V001InitialSchema()]
    try:
        from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes
        _migrations.append(V002AddIndexes())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
        _migrations.append(V003MemoryFts())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v004_workflow_executions import V004WorkflowExecutions
        _migrations.append(V004WorkflowExecutions())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v005_workflow_versions import V005WorkflowVersions
        _migrations.append(V005WorkflowVersions())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v006_agent_orchestration import V006AgentOrchestration
        _migrations.append(V006AgentOrchestration())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v007_audit_role import V007AuditRole
        _migrations.append(V007AuditRole())
    except ImportError:
        pass

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


@db_app.command("version")
def db_version(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_db_version_async(data_dir))


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


@db_app.command("rollback")
def db_rollback(
    target_version: int = typer.Argument(..., help="Target schema version to rollback to"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_db_rollback_async(target_version, data_dir))


async def _db_rollback_async(target_version: int, data_dir: str) -> None:
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    _migrations = [V001InitialSchema()]
    try:
        from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes
        _migrations.append(V002AddIndexes())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
        _migrations.append(V003MemoryFts())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v004_workflow_executions import V004WorkflowExecutions
        _migrations.append(V004WorkflowExecutions())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v005_workflow_versions import V005WorkflowVersions
        _migrations.append(V005WorkflowVersions())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v006_agent_orchestration import V006AgentOrchestration
        _migrations.append(V006AgentOrchestration())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v007_audit_role import V007AuditRole
        _migrations.append(V007AuditRole())
    except ImportError:
        pass

    runner = MigrationRunner(db_path, _migrations)
    await runner.initialize()
    await runner.rollback_to(target_version)
    version = await runner.current_version()
    await runner.close()
    console.print(f"[green]Rolled back to schema version {version}.[/green]")


backup_app = typer.Typer(name="backup", help="Backup management")
app.add_typer(backup_app, name="backup")


@backup_app.command("create")
def backup_create(
    label: str = typer.Option("", "--label", help="Backup label"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_backup_create_async(label, data_dir))


async def _backup_create_async(label: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    metadata = await manager.create_backup(label=label)
    console.print(f"[green]Backup created:[/green] {metadata.backup_path}")
    console.print(f"  Size: {metadata.file_size} bytes | Schema: v{metadata.schema_version}")


@backup_app.command("list")
def backup_list(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_backup_list_async(data_dir))


async def _backup_list_async(data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    backups = await manager.list_backups()
    if not backups:
        console.print("[yellow]No backups found.[/yellow]")
        return
    for b in backups:
        console.print(f"  {b.backup_path} | {b.created_at} | {b.file_size} bytes | schema v{b.schema_version}")


@backup_app.command("restore")
def backup_restore(
    backup_path: str = typer.Argument(..., help="Path to backup file"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_backup_restore_async(backup_path, data_dir))


async def _backup_restore_async(backup_path: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    await manager.restore_backup(backup_path)
    console.print(f"[green]Restored from:[/green] {backup_path}")


@backup_app.command("delete")
def backup_delete(
    backup_path: str = typer.Argument(..., help="Path to backup file"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_backup_delete_async(backup_path, data_dir))


async def _backup_delete_async(backup_path: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir)
    await manager.delete_backup(backup_path)
    console.print(f"[green]Deleted backup:[/green] {backup_path}")


@backup_app.command("schedule")
def backup_schedule(
    interval: float = typer.Option(24, "--interval", help="Backup interval in hours"),
    max_backups: int = typer.Option(10, "--max-backups", help="Maximum scheduled backups to keep"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_backup_schedule_async(interval, max_backups, data_dir))


async def _backup_schedule_async(interval: float, max_backups: int, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager, ScheduledBackupManager

    manager = BackupManager(data_dir)
    scheduled = ScheduledBackupManager(manager, interval_hours=interval, max_backups=max_backups)
    console.print(f"[green]Starting scheduled backup[/green] (every {interval}h, max {max_backups} backups)")
    console.print("[dim]Press Ctrl+C to stop[/dim]")
    await scheduled.start()
    try:
        import signal
        event = asyncio.Event()
        signal.signal(signal.SIGINT, lambda *_: event.set())
        signal.signal(signal.SIGTERM, lambda *_: event.set())
        await event.wait()
    except (KeyboardInterrupt, RuntimeError):
        pass
    finally:
        await scheduled.stop()
    console.print("[green]Scheduled backup stopped[/green]")


@backup_app.command("unschedule")
def backup_unschedule(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    console.print("[yellow]Scheduled backup is not running in this process.[/yellow]")
    console.print("[dim]To stop a running schedule, use Ctrl+C in the terminal running 'cabinet backup schedule'[/dim]")


@app.command("set-api-token")
def set_api_token(
    token: str = typer.Argument(..., help="API token to set"),
    role: str = typer.Option("viewer", "--role", help="Token role: admin, editor, viewer"),
    label: str = typer.Option("", "--label", help="Token label"),
    config_path: str = typer.Option("data/cabinet.json", "--config", help="Config file path"),
):
    import hashlib
    from cabinet.cli.config import ApiTokenEntry, load_config, save_config
    from cabinet.core.auth import Role

    try:
        role_enum = Role(role)
    except ValueError:
        console.print(f"[red]Invalid role:[/red] {role}. Must be admin, editor, or viewer.")
        raise typer.Exit(code=1)

    config = load_config(config_path)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    entry = ApiTokenEntry(token_hash=token_hash, role=role_enum, label=label or f"token-{len(config.api_tokens)+1}")
    config.api_tokens.append(entry)
    save_config(config, config_path)
    console.print(f"[green]API token added:[/green] {entry.label} (role={entry.role.value})")


if __name__ == "__main__":
    app()


workflow_app = typer.Typer(name="workflow", help="Workflow management")
app.add_typer(workflow_app, name="workflow")


@workflow_app.command("list-versions")
def workflow_list_versions(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_list_versions_async(workflow_id, data_dir))


async def _workflow_list_versions_async(workflow_id: str, data_dir: str) -> None:
    import aiosqlite
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


agent_app = typer.Typer(name="agent", help="Agent orchestration management")
app.add_typer(agent_app, name="agent")


@agent_app.command("pool-status")
def agent_pool_status(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_agent_pool_status_async(data_dir))


async def _agent_pool_status_async(data_dir: str) -> None:
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


@agent_app.command("discover")
def agent_discover(
    role: str = typer.Option(None, "--role", help="Filter by role"),
    skill: str = typer.Option(None, "--skill", help="Filter by skill"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_agent_discover_async(role, skill, data_dir))


async def _agent_discover_async(role: str | None, skill: str | None, data_dir: str) -> None:
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


@agent_app.command("compose-team")
def agent_compose_team(
    task: str = typer.Argument(..., help="Task description"),
    roles: str = typer.Option("", "--roles", help="Comma-separated required roles"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_agent_compose_team_async(task, roles, data_dir))


async def _agent_compose_team_async(task: str, roles: str, data_dir: str) -> None:
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


@workflow_app.command("visualize")
def workflow_visualize(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    version: int = typer.Option(0, "--version", "-v", help="Version number (0=latest)"),
    format: str = typer.Option("mermaid", "--format", "-f", help="Output format: mermaid, json"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_visualize_async(workflow_id, version, format, data_dir))


async def _workflow_visualize_async(workflow_id: str, version: int, format: str, data_dir: str) -> None:
    import aiosqlite
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


@workflow_app.command("show-version")
def workflow_show_version(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    version: int = typer.Argument(..., help="Version number"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_show_version_async(workflow_id, version, data_dir))


async def _workflow_show_version_async(workflow_id: str, version: int, data_dir: str) -> None:
    import aiosqlite
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
