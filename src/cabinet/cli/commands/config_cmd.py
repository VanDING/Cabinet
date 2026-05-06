from __future__ import annotations

import os

import typer
from rich.console import Console

console = Console()


def register(app):
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
