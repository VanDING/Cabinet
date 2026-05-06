from __future__ import annotations

import asyncio
import os
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel


console = Console()


def register(app):
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

        from cabinet.cli.main import _init_db
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
            from cabinet.cli.main import _preflight_check_async
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
        from cabinet.cli.main import _update_models_json

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
