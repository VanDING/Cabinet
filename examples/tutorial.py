"""Cabinet Interactive Tutorial.

Usage:
    python examples/tutorial.py --data-dir data
    python examples/tutorial.py --data-dir data --live
"""
import argparse
import asyncio
import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress
from rich.prompt import Prompt

from _shared import setup_runtime

console = Console()
STEPS = 6


def pause():
    Prompt.ask("\n[dim]Press Enter to continue[/dim]", default="")


async def run_tutorial(data_dir: str, live: bool = False):
    console.print(Panel(
        "[bold green]Welcome to the Cabinet Interactive Tutorial![/bold green]\n\n"
        "This tutorial will guide you through Cabinet's core features.\n"
        f"Mode: {'Live (LLM)' if live else 'Stub (no LLM needed)'}",
        title="Cabinet Tutorial",
    ))
    pause()

    runtime, config = await setup_runtime(data_dir, live)
    captain_id = config.organization.captain_id

    try:
        with Progress() as progress:
            task = progress.add_task("[cyan]Tutorial Progress", total=STEPS)

            progress.update(task, description="[cyan]Step 1/6: Initialize & Greet")
            console.print("\n[bold cyan]Step 1: Initialize & Greet[/bold cyan]")
            console.print("CabinetRuntime starts, Secretary greets the Captain.")
            greeting = await runtime.secretary.greet(captain_id=captain_id)
            console.print(Panel(greeting.message, title="Secretary"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 2/6: Chat with Secretary")
            console.print("\n[bold cyan]Step 2: Chat with Secretary[/bold cyan]")
            console.print("Type a message to the Secretary (or press Enter for default):")
            user_msg = Prompt.ask("[bold cyan]Captain[/bold cyan]", default="What's our current status?")
            from cabinet.rooms.secretary.models import InteractionContext
            context = InteractionContext(captain_id=captain_id, channel="tutorial")
            response = await runtime.secretary.process_input(user_msg, context)
            console.print(Panel(response.message, title="Secretary"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 3/6: Meeting Room")
            console.print("\n[bold cyan]Step 3: Meeting Room Deliberation[/bold cyan]")
            console.print("Multiple perspectives converge on a proposal.")
            from cabinet.rooms.meeting.models import MeetingLevel
            participants = [uuid4(), uuid4()]
            session = await runtime.meeting.start_session(
                topic="Product strategy pivot", level=MeetingLevel.MULTI_PARTY, participants=participants,
            )
            for pid in participants:
                await runtime.meeting.add_perspective(session.id, pid)
            await runtime.meeting.cross_validate(session.id)
            result = await runtime.meeting.converge(session.id)
            console.print(Panel(result.proposal_text[:200], title="Convergence"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 4/6: Decision Room")
            console.print("\n[bold cyan]Step 4: Decision Room[/bold cyan]")
            console.print("Submit a decision for ruling.")
            from cabinet.models.events import DecisionRequest
            from cabinet.models.decisions import DecisionType
            request = DecisionRequest(
                decision_id=uuid4(), decision_type=DecisionType.STRATEGIC.value,
                title="Pivot strategy", options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            decision = await runtime.decision.submit(request)
            console.print(f"Decision: {decision.title} - {decision.status}")
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 5/6: Office Room")
            console.print("\n[bold cyan]Step 5: Office Room Execution[/bold cyan]")
            console.print("Submit a task for automated execution.")
            from cabinet.models.events import TaskOrder
            order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"description": "Analysis"})
            task_result = await runtime.office.submit_task(order)
            console.print(f"Task: {task_result.id} - {task_result.status}")
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 6/6: Observability")
            console.print("\n[bold cyan]Step 6: Observability[/bold cyan]")
            console.print("Check system health and metrics.")
            health = await runtime.health_check()
            console.print(f"Overall: {health['status']}")
            for c in health["components"]:
                console.print(f"  {c['name']}: {c['status']} ({c['latency_ms']:.1f}ms)")
            console.print("\nPrometheus metrics: http://localhost:9090/metrics")
            progress.advance(task)

    finally:
        await runtime.stop()

    console.print(Panel(
        "[bold green]Tutorial complete![/bold green]\n\n"
        "You've experienced Cabinet's core workflow:\n"
        "Secretary -> Meeting -> Decision -> Office -> Summary\n\n"
        "Explore more with: cabinet chat",
        title="Congratulations!",
    ))


def main():
    parser = argparse.ArgumentParser(description="Cabinet Interactive Tutorial")
    parser.add_argument("--data-dir", default="data", help="Data directory path")
    parser.add_argument("--live", action="store_true", help="Use live LLM (requires API key)")
    args = parser.parse_args()
    asyncio.run(run_tutorial(args.data_dir, args.live))


if __name__ == "__main__":
    main()
