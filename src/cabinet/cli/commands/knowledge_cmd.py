from __future__ import annotations

import asyncio
import os
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel

console = Console()

knowledge_app = typer.Typer(name="knowledge", help="Manage knowledge base")


def register(app):
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

    app.add_typer(knowledge_app, name="knowledge")


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
