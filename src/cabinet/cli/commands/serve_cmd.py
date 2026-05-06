from __future__ import annotations

import asyncio
import os

import typer
from rich.console import Console

console = Console()


def register(app):
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
            from cabinet.cli.main import _init_runtime

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
