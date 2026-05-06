"""Cabinet end-to-end workflow demo.

Usage:
    python examples/e2e_workflow.py --data-dir data
    python examples/e2e_workflow.py --data-dir data --live
"""
import argparse
import asyncio
import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from _shared import setup_runtime

console = Console()


async def run_demo(data_dir: str, live: bool = False):
    console.print(Panel("[bold green]Cabinet E2E Workflow Demo[/bold green]", title="Cabinet"))
    console.print(f"Mode: {'Live (LLM)' if live else 'Stub (no LLM needed)'}\n")

    runtime, config = await setup_runtime(data_dir, live)
    captain_id = config.organization.captain_id

    try:
        console.print("[bold cyan]Step 1:[/bold cyan] Secretary greets Captain")
        greeting = await runtime.secretary.greet(captain_id=captain_id)
        console.print(Panel(greeting.message, title="Secretary"))
        console.print()

        console.print("[bold cyan]Step 2:[/bold cyan] Captain submits strategic proposal")
        proposal = "We should pivot from a general AI assistant to vertical industry solutions"
        console.print(f"Captain: {proposal}\n")

        console.print("[bold cyan]Step 3:[/bold cyan] Meeting Room deliberation")
        from cabinet.rooms.meeting.models import MeetingLevel
        participants = [uuid4(), uuid4()]
        session = await runtime.meeting.start_session(
            topic=proposal, level=MeetingLevel.MULTI_PARTY, participants=participants,
        )
        for pid in participants:
            await runtime.meeting.add_perspective(session.id, pid)
        await runtime.meeting.cross_validate(session.id)
        result = await runtime.meeting.converge(session.id)
        console.print(Panel(result.proposal_text[:300], title="Meeting Result"))
        console.print()

        console.print("[bold cyan]Step 4:[/bold cyan] Strategy Room decodes blueprint")
        from cabinet.rooms.strategy.models import DecodeContext
        from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult, ConvergenceResult
        proposal_output = DeliberationOutput(
            session_id=session.id,
            proposal=DeliberationResult(
                session_id=session.id, proposal_text=proposal, confidence=0.8,
                reasoning_summary="deliberation", convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
                rounds_used=1, rumination_detected=False,
            ),
        )
        context = DecodeContext(project_id=config.default_project, captain_id=captain_id, existing_constraints=[])
        blueprint = await runtime.strategy.decode(proposal_output, context)
        table = Table(title="Blueprint Domains")
        table.add_column("Domain", style="cyan")
        for d in blueprint.domains:
            table.add_row(d.name)
        console.print(table)
        console.print()

        console.print("[bold cyan]Step 5:[/bold cyan] Decision Room rules")
        from cabinet.models.events import DecisionRequest
        from cabinet.models.decisions import DecisionType
        request = DecisionRequest(
            decision_id=uuid4(), decision_type=DecisionType.STRATEGIC.value,
            title="Pivot to vertical solutions", options=[{"label": "Approve"}, {"label": "Reject"}],
        )
        decision = await runtime.decision.submit(request)
        console.print(f"Decision: {decision.title} - {decision.status}")
        console.print()

        console.print("[bold cyan]Step 6:[/bold cyan] Office Room executes task")
        from cabinet.models.events import TaskOrder
        order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"description": "Market analysis"})
        task = await runtime.office.submit_task(order)
        console.print(f"Task: {task.id} - {task.status}")
        console.print()

        console.print("[bold cyan]Step 7:[/bold cyan] Summary Room learns")
        from cabinet.rooms.summary.models import ReviewType
        review = await runtime.summary.start_review(project_id=config.default_project, review_type=ReviewType.PROJECT_REVIEW)
        insights = await runtime.summary.generate_insights(review.id)
        console.print(f"Generated {len(insights)} insights")
        console.print()

        console.print("[bold cyan]Step 8:[/bold cyan] Observability check")
        health = await runtime.health_check()
        console.print(f"Health: {health['status']}")
        for c in health["components"]:
            console.print(f"  {c['name']}: {c['status']} ({c['latency_ms']:.1f}ms)")
        console.print("Prometheus: http://localhost:9090/metrics")
        console.print()

    finally:
        await runtime.stop()

    console.print(Panel("[bold green]Demo complete![/bold green]", title="Cabinet"))


def main():
    parser = argparse.ArgumentParser(description="Cabinet E2E Workflow Demo")
    parser.add_argument("--data-dir", default="data", help="Data directory path")
    parser.add_argument("--live", action="store_true", help="Use live LLM (requires API key)")
    args = parser.parse_args()
    asyncio.run(run_demo(args.data_dir, args.live))


if __name__ == "__main__":
    main()
